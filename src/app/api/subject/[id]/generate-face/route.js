// src/app/api/subject/[id]/generate-face/route.js
import { NextResponse } from "next/server";
import { createServerSupabase } from "../../../../../../utils/supabase/server";
import { supabaseAdmin } from "../../../../../../lib/supabaseServer";
import Replicate from "replicate";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const GENERATED_BUCKET = process.env.SUPABASE_GENERATED_BUCKET || "generated";
const UPLOAD_BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || "uploads";
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_MODEL_NAME = process.env.REPLICATE_MODEL_NAME || "google/nano-banana";
const SIGNED_URL_TTL = Number(process.env.SIGNED_URL_TTL_SECONDS || 1200);

// ---------- small helpers (adapted from worker) ----------
function extToMimeFromPath(p) {
  const ext = (path.extname(p || "") || "").toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

/** create signed url for object path (using service role) */
async function makeSignedUrl(bucket, objectPath, ttl = SIGNED_URL_TTL) {
  try {
    const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(objectPath, ttl);
    if (error) {
      console.warn("createSignedUrl error", { bucket, objectPath, error });
      return null;
    }
    return data?.signedUrl || null;
  } catch (e) {
    console.warn("createSignedUrl threw", e);
    return null;
  }
}

/** upload buffer to storage and return { objectPath, url } */
async function uploadBufferToStorage(buffer, objectPath, bucket = GENERATED_BUCKET) {
  const contentType = extToMimeFromPath(objectPath) || "application/octet-stream";
  const { error: upErr } = await supabaseAdmin.storage.from(bucket).upload(objectPath, buffer, {
    contentType,
    upsert: false,
  });
  if (upErr) {
    throw upErr;
  }
  // create signed url
  const signed = await makeSignedUrl(bucket, objectPath);
  return { objectPath, url: signed };
}

/**
 * Extract possible outputs from replicate.run results.
 * This is a small, pragmatic version: handles strings, arrays, and common object shapes with `.url`, `.image`, `.output`, `base64` or `b64`.
 */
async function extractOutputsGeneric(out) {
  const results = [];
  if (!out && out !== 0) return results;
  if (typeof out === "string") {
    if (out.startsWith("data:")) results.push({ type: "data", value: out });
    else if (/^https?:\/\//i.test(out)) results.push({ type: "url", value: out });
    else results.push({ type: "string", value: out });
    return results;
  }
  if (Array.isArray(out)) {
    for (const e of out) results.push(...(await extractOutputsGeneric(e)));
    return results;
  }
  if (typeof out === "object") {
    if (out.url) results.push(...(await extractOutputsGeneric(out.url)));
    if (out.image) results.push(...(await extractOutputsGeneric(out.image)));
    if (out.output) results.push(...(await extractOutputsGeneric(out.output)));
    if (out.result) results.push(...(await extractOutputsGeneric(out.result)));
    if (out.base64 || out.b64 || out.b64_json) {
      const b64 = out.base64 || out.b64 || out.b64_json;
      if (typeof b64 === "string") results.push({ type: "base64", value: b64 });
    }
    // try to find any URL strings inside object
    try {
      const s = JSON.stringify(out);
      const found = s.match(/https?:\/\/[^\s"']+/g);
      if (found) for (const u of Array.from(new Set(found))) results.push({ type: "url", value: u });
    } catch (e) {}
    return results;
  }
  return results;
}

/** Save a single extracted item to storage (returns { objectPath, url }) */
async function saveExtractedItemToStorage(item, subjectId, idx) {
  if (!item) return null;
  const fname = `nb-${subjectId}-${Date.now()}-${idx}.png`;
  const objectPath = `${subjectId}/${fname}`;

  if (item.type === "url") {
    const r = await fetch(item.value);
    if (!r.ok) throw new Error(`Failed to fetch ${item.value} status ${r.status}`);
    const arr = new Uint8Array(await r.arrayBuffer());
    const buffer = Buffer.from(arr);
    return await uploadBufferToStorage(buffer, objectPath, GENERATED_BUCKET);
  }
  if (item.type === "data") {
    const parts = item.value.split(",");
    if (parts.length !== 2) throw new Error("Invalid data URI");
    const b64 = parts[1];
    const buffer = Buffer.from(b64, "base64");
    return await uploadBufferToStorage(buffer, objectPath, GENERATED_BUCKET);
  }
  if (item.type === "base64") {
    const buffer = Buffer.from(item.value, "base64");
    return await uploadBufferToStorage(buffer, objectPath, GENERATED_BUCKET);
  }
  if (item.type === "string") {
    if (/^https?:\/\//i.test(item.value)) {
      return await saveExtractedItemToStorage({ type: "url", value: item.value }, subjectId, idx);
    }
    return null;
  }
  return null;
}

// ---------- route ----------
export async function POST(req, { params }) {
  try {
    const supabase = await createServerSupabase();

    try {
      const cookieHeader = req.headers.get("cookie");
      console.log("[generate-face] incoming Cookie header:", cookieHeader ? "[present]" : "[none]");
    } catch (e) { /** ignore */ }

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr) console.warn("[generate-face] auth.getUser returned error:", userErr);
    const user = userData?.user;
    if (!user) {
      console.warn("[generate-face] Not authenticated (no user)");
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = user.id;
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Missing subject id" }, { status: 400 });

    // ownership check (request-bound client obeys RLS)
    const { data: subject, error: subjErr } = await supabase
      .from("subjects")
      .select("id, owner_id, name, base_prompt, assets, status")
      .eq("id", id)
      .single();

    if (subjErr || !subject) {
      console.error("[generate-face] subject lookup error:", subjErr);
      return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    }
    if (String(subject.owner_id) !== String(userId)) {
      console.warn("[generate-face] Forbidden: user", userId, "is not owner of subject", id);
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const prompt = typeof body?.prompt === "string" ? body.prompt : subject.base_prompt || "";
    const image_input = Array.isArray(body?.image_input) ? body.image_input : [];
    const settings = body?.settings ?? {};
    const previewOnly = !!body?.previewOnly;

    if (typeof prompt === "string" && prompt.length > 8000) {
      return NextResponse.json({ error: "Prompt too long" }, { status: 400 });
    }
    if (image_input.length > 8) {
      return NextResponse.json({ error: "Too many image inputs (max 8)" }, { status: 400 });
    }

    // If previewOnly AND Replicate token present -> attempt synchronous generation + persist
    if (previewOnly && REPLICATE_API_TOKEN) {
      try {
        console.log("[generate-face] performing synchronous preview generation (previewOnly=true)");

        const replicate = new Replicate({ auth: REPLICATE_API_TOKEN });

        // Build input for replicate model (mirrors worker)
        const input = {};
        if (prompt) input.prompt = prompt;
        if (Array.isArray(image_input) && image_input.length) input.image_input = image_input;
        if (settings && typeof settings === "object") Object.assign(input, settings);
        if (!input.prompt && (!input.image_input || input.image_input.length === 0)) {
          input.prompt = subject.base_prompt || subject.description || "Photorealistic close-up portrait, neutral expression, studio lighting.";
        }

        console.log("[generate-face] calling replicate model:", REPLICATE_MODEL_NAME);
        const rawOutput = await replicate.run(REPLICATE_MODEL_NAME, { input });

        // normalize outputs
        const extracted = await extractOutputsGeneric(rawOutput);
        if (!extracted || extracted.length === 0) {
          throw new Error("No outputs from Replicate");
        }

        // save each extracted item to storage
        const saved = [];
        for (let i = 0; i < extracted.length; i++) {
          try {
            const s = await saveExtractedItemToStorage(extracted[i], id, i);
            if (s) saved.push(s);
          } catch (err) {
            console.warn("Failed to save extracted item:", extracted[i], err);
          }
        }
        if (saved.length === 0) {
          throw new Error("Failed to save any outputs");
        }

        // create canonical asset objects and update subject (use service role)
        const newAssets = (subject.assets || []).concat(saved.map((s) => ({
          type: "generated_face",
          url: s.url,
          object_path: s.objectPath,
          created_at: new Date().toISOString(),
          meta: { model: REPLICATE_MODEL_NAME, prompt: prompt || null }
        })));

        const { error: updErr } = await supabaseAdmin
          .from("subjects")
          .update({ assets: newAssets, status: "awaiting-approval", updated_at: new Date().toISOString() })
          .eq("id", id);

        if (updErr) {
          console.warn("[generate-face] failed updating subject with generated assets:", updErr);
        } else {
          console.log("[generate-face] persisted generated assets to subject", id);
        }

        // fetch fresh subject
        const { data: freshSubject2, error: freshErr2 } = await supabaseAdmin
          .from("subjects")
          .select("*")
          .eq("id", id)
          .single();

        if (freshErr2) {
          console.warn("[generate-face] could not fetch subject after persist:", freshErr2);
        }

        // build images array to return
        const images = saved.map(s => ({ url: s.url, objectPath: s.objectPath }));

        return NextResponse.json({ ok: true, jobId: null, images, subject: freshSubject2 || { ...subject, assets: newAssets } });
      } catch (err) {
        console.warn("[generate-face] synchronous generation failed, falling back to enqueue job:", err);
        // fallthrough to enqueue fallback below
      }
    }

    // FALLBACK: enqueue job row for async worker (request-bound client obeys RLS)
    const payload = { prompt, image_input, settings, previewOnly };
    const { data: jobData, error: jobErr } = await supabase
      .from("jobs")
      .insert([
        {
          subject_id: id,
          type: "generate-face",
          payload,
          status: "queued",
        },
      ])
      .select()
      .single();

    if (jobErr) {
      console.error("[generate-face] failed to insert job:", jobErr);
      return NextResponse.json({ error: "Failed to enqueue job" }, { status: 500 });
    }

    // fetch the subject row again to return to client (helps client show immediate state)
    const { data: freshSubject, error: freshErr } = await supabase
      .from("subjects")
      .select("id, owner_id, name, base_prompt, assets, status")
      .eq("id", id)
      .single();

    if (freshErr) {
      console.warn("[generate-face] could not fetch subject after enqueue:", freshErr);
    }

    console.log("[generate-face] enqueued job", jobData?.id, "for subject", id);

    return NextResponse.json({
      ok: true,
      jobId: jobData?.id || null,
      images: [],
      subject: freshSubject || subject || null,
    });
  } catch (err) {
    console.error("[generate-face] route error:", err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
