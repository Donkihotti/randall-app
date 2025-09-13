// src/app/api/projects/[projectId]/photoshoots/route.js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

/* reuse the same cookie helpers (copy/paste) */
function parseCookies(cookieHeader = "") {
  if (!cookieHeader) return {};
  return cookieHeader.split(";").map(c => c.trim()).filter(Boolean).reduce((acc, pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return acc;
    const name = decodeURIComponent(pair.slice(0, idx).trim());
    const val = decodeURIComponent(pair.slice(idx + 1).trim());
    acc[name] = val;
    acc[name.toLowerCase()] = val;
    return acc;
  }, {});
}

function extractAccessTokenFromCookies(cookies = {}) {
  if (!cookies || typeof cookies !== "object") return null;
  if (cookies["sb-access-token"]) return cookies["sb-access-token"];
  if (cookies["sb-debug-access"]) return cookies["sb-debug-access"];
  const authKey = Object.keys(cookies).find(k => k && k.toLowerCase().endsWith("-auth-token"));
  if (authKey) {
    const raw = cookies[authKey];
    if (!raw) return null;
    if (raw.startsWith("base64-")) {
      try {
        const b64 = raw.slice("base64-".length);
        const decoded = Buffer.from(b64, "base64").toString("utf8");
        const parsed = JSON.parse(decoded);
        if (parsed?.access_token) return parsed.access_token;
        if (parsed?.session?.access_token) return parsed.session.access_token;
        for (const v of Object.values(parsed || {})) {
          if (v && typeof v === "object") {
            if (v.access_token) return v.access_token;
            if (v.session?.access_token) return v.session.access_token;
          }
        }
      } catch (e) {
        console.warn("[api/projects/photoshoots] failed to decode base64 cookie", e);
      }
    } else {
      return raw;
    }
  }
  const candidate = Object.keys(cookies).find(k => cookies[k] && cookies[k].length > 100);
  if (candidate) return cookies[candidate];
  return null;
}

async function getUserIdFromRequest(request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookies = parseCookies(cookieHeader);
  const token = extractAccessTokenFromCookies(cookies);
  if (!token) throw new Error("no_access_token");
  const { data: userData, error } = await supabaseAdmin.auth.getUser(token);
  if (error) {
    console.error("[api/projects/photoshoots] auth.getUser error:", error);
    throw new Error("invalid_token");
  }
  const userId = userData?.user?.id;
  if (!userId) throw new Error("invalid_user");
  return userId;
}

/* POST handler for nested photoshoot creation */
export async function POST(request, { params }) {
  try {
    const projectId = params?.projectId;
    if (!projectId) return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });

    const userId = await getUserIdFromRequest(request);
    console.log("[api/projects/:projectId/photoshoots POST] userId:", userId, "projectId:", projectId);

    // Validate project exists and belongs to user
    const { data: projectRow, error: projErr } = await supabaseAdmin
      .from("projects")
      .select("id, owner_id")
      .eq("id", projectId)
      .limit(1)
      .maybeSingle();

    if (projErr) {
      console.error("[api/projects/photoshoots] project lookup error", projErr);
      return NextResponse.json({ ok: false, error: "Failed to validate project" }, { status: 500 });
    }
    if (!projectRow) {
      return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });
    }
    if (projectRow.owner_id !== userId) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    // body parsing
    const body = await request.json().catch(() => ({}));
    const name = (body.name || "").toString().trim() || "Untitled photoshoot";
    const prompt = body.prompt ? body.prompt.toString() : null;
    const prompt_meta = body.prompt_meta && typeof body.prompt_meta === "object" ? body.prompt_meta : null;
    const reference_collection_ids = Array.isArray(body.reference_collection_ids) ? body.reference_collection_ids : null;
    const parameters = body.parameters && typeof body.parameters === "object" ? body.parameters : null;

    const insertRow = {
      project_id: projectId,
      owner_id: userId,
      name,
      prompt,
      prompt_meta,
      reference_collection_ids,
      parameters,
      status: "queued",
    };

    const { data: created, error: insertErr } = await supabaseAdmin
      .from("photoshoots")
      .insert([insertRow])
      .select()
      .limit(1)
      .maybeSingle();

    if (insertErr) {
      console.error("[api/projects/photoshoots POST] insert error", insertErr);
      return NextResponse.json({ ok: false, error: "Failed to create photoshoot" }, { status: 500 });
    }

    console.log("[api/projects/photoshoots POST] created photoshoot id:", created?.id);

    // TODO: enqueue job; worker should poll for status='queued'

    return NextResponse.json({ ok: true, photoshoot: created }, { status: 201 });
  } catch (err) {
    console.error("[api/projects/photoshoots POST] unexpected", err);
    const msg = err?.message || String(err);
    if (msg === "no_access_token" || msg === "invalid_token" || msg === "invalid_user") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
