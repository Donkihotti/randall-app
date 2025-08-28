import fs from "fs";
import path from "path";
import Replicate from "replicate";
import { NextResponse } from "next/server";

const ROOT = process.cwd();
const SUBJECT_DIR = path.join(ROOT, "data", "subjects");
const GENERATED_DIR = path.join(ROOT, "public", "generated");
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

// create Replicate client (reads from process.env.REPLICATE_API_TOKEN)
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

/**
 * Extract potential outputs from replicate.run result.
 * This is async because some outputs may be functions like `.url()` we must call.
 * Returns array of normalized items: { type: "url"|"data"|"base64", value: string, meta?: any }
 */
async function extractOutputsAsync(out) {
  const results = [];

  if (!out) return results;

  // If it's a string: may be a url or data URI
  if (typeof out === "string") {
    if (out.startsWith("data:")) {
      results.push({ type: "data", value: out });
    } else if (out.startsWith("http://") || out.startsWith("https://")) {
      results.push({ type: "url", value: out });
    }
    return results;
  }

  // If it's an array, recurse on elements
  if (Array.isArray(out)) {
    for (const e of out) {
      results.push(...(await extractOutputsAsync(e)));
    }
    return results;
  }

  // If it's a function itself (rare), call it (may return string or promise)
  if (typeof out === "function") {
    try {
      const val = out();
      const awaited = val instanceof Promise ? await val : val;
      results.push(...(await extractOutputsAsync(awaited)));
    } catch (e) {
      console.warn("extractOutputs: calling function failed", e);
    }
    return results;
  }

  // If it's an object, check multiple common patterns:
  if (typeof out === "object") {
    // 1) `.url` could be a string or a function
    if (out.url) {
      if (typeof out.url === "function") {
        try {
          const val = out.url();
          const awaited = val instanceof Promise ? await val : val;
          results.push(...(await extractOutputsAsync(awaited)));
        } catch (e) {
          console.warn("extractOutputs: out.url() call failed", e);
        }
      } else {
        results.push(...(await extractOutputsAsync(out.url)));
      }
    }

    // 2) Some shapes use `image`, `output`, `result`, etc.
    if (out.image) results.push(...(await extractOutputsAsync(out.image)));
    if (out.output) results.push(...(await extractOutputsAsync(out.output)));
    if (out.result) results.push(...(await extractOutputsAsync(out.result)));
    if (out.data) {
      // data might be base64 or data-uri
      if (typeof out.data === "string") {
        if (out.data.startsWith("data:")) results.push({ type: "data", value: out.data });
        else results.push({ type: "base64", value: out.data });
      } else {
        results.push(...(await extractOutputsAsync(out.data)));
      }
    }

    // 3) common base64 fields
    if (out.base64 || out.b64 || out.b64_json) {
      const b64 = out.base64 || out.b64 || out.b64_json;
      if (typeof b64 === "string") {
        results.push({ type: "base64", value: b64, mime: "image/png" });
      }
    }

    // 4) fallback: try to find URLs inside the object stringified
    try {
      const s = JSON.stringify(out);
      const found = s.match(/https?:\/\/[^\s"']+/g);
      if (found) {
        for (const u of Array.from(new Set(found))) results.push({ type: "url", value: u });
      }
    } catch (e) {}
  }

  return results;
}

/**
 * Save an extracted item to disk. Returns { url: publicUrl, path, source }
 */
async function saveExtractedItem(item, id, index) {
  if (!item) return null;
  const fname = `rep-nb-${id}-${Date.now()}-${index}.png`;
  const outPath = path.join(GENERATED_DIR, fname);

  if (item.type === "url") {
    // download
    const r = await fetch(item.value);
    if (!r.ok) throw new Error(`Failed to fetch ${item.value} status ${r.status}`);
    const arr = new Uint8Array(await r.arrayBuffer());
    fs.writeFileSync(outPath, Buffer.from(arr));
    return { url: `/generated/${fname}`, path: outPath, source: item.value };
  }

  if (item.type === "data") {
    // data:<mime>;base64,<b64>
    const parts = item.value.split(",");
    if (parts.length !== 2) throw new Error("Invalid data URI");
    const b64 = parts[1];
    fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
    return { url: `/generated/${fname}`, path: outPath, source: "data-uri" };
  }

  if (item.type === "base64") {
    fs.writeFileSync(outPath, Buffer.from(item.value, "base64"));
    return { url: `/generated/${fname}`, path: outPath, source: "base64" };
  }

  return null;
}

export async function POST(req, context) {
  try {
    const params = context?.params;
    const resolvedParams = params && typeof params.then === "function" ? await params : params;
    const { id } = resolvedParams || {};
    if (!id) return NextResponse.json({ error: "Missing subject id" }, { status: 400 });

    const subjFile = path.join(SUBJECT_DIR, `${id}.json`);
    if (!fs.existsSync(subjFile)) return NextResponse.json({ error: "Subject not found" }, { status: 404 });

    const body = await req.json(); // { prompt?, image_input?:[], settings?:{...}, previewOnly?:true }
    const subj = JSON.parse(fs.readFileSync(subjFile, "utf8"));

    if (!process.env.REPLICATE_API_TOKEN) {
      console.error("REPLICATE_API_TOKEN not set");
      return NextResponse.json({ error: "Server misconfiguration: REPLICATE_API_TOKEN not set" }, { status: 500 });
    }

    // Build input
    const input = {};
    if (body?.prompt) input.prompt = body.prompt;
    if (Array.isArray(body?.image_input) && body.image_input.length) input.image_input = body.image_input;
    if (body?.settings && typeof body.settings === "object") {
      Object.keys(body.settings).forEach((k) => {
        if (body.settings[k] !== undefined && body.settings[k] !== null) input[k] = body.settings[k];
      });
    }
    if (!input.prompt && !input.image_input) {
      input.prompt = subj.basePrompt || subj.description || "Photorealistic close-up portrait, neutral expression, studio lighting.";
    }

    const modelId = process.env.REPLICATE_MODEL_NAME || "google/nano-banana";
    console.log("Calling Replicate.run model=", modelId, "input=", input);

    let rawOutput;
    try {
      rawOutput = await replicate.run(modelId, { input });
      console.log("Replicate raw output (type:", typeof rawOutput, "):", rawOutput && (Array.isArray(rawOutput) ? rawOutput.slice(0,2) : rawOutput));
    } catch (e) {
      console.error("Replicate.run error:", e);
      return NextResponse.json({ error: "Replicate.run failed: " + String(e) }, { status: 500 });
    }

    // Extract outputs (async to support functions like .url())
    const extracted = await extractOutputsAsync(rawOutput);
    console.log("Extracted outputs:", extracted);

    if (!extracted || extracted.length === 0) {
      console.error("No extractable outputs from replicate:", rawOutput);
      return NextResponse.json({ error: "Replicate returned no image outputs", raw: rawOutput }, { status: 500 });
    }

    const saved = [];
    for (let i = 0; i < extracted.length; i++) {
      try {
        const s = await saveExtractedItem(extracted[i], id, i);
        if (s) saved.push(s);
      } catch (err) {
        console.warn("Failed to save extracted item:", extracted[i], err);
      }
    }

    if (saved.length === 0) {
      console.error("Failed to download/save outputs; extracted:", extracted);
      return NextResponse.json({ error: "Failed to download outputs from Replicate", raw: rawOutput, extracted }, { status: 500 });
    }

    subj.assets = subj.assets || [];
    for (const s of saved) {
      subj.assets.push({
        type: "generated_face_replicate",
        url: s.url,
        createdAt: new Date().toISOString(),
        meta: { model: modelId, prompt: input.prompt || null, source: s.source || null }
      });
    }

    // optionally add generated faceRef as first faceRef
    if (saved[0]) {
      subj.faceRefs = subj.faceRefs || [];
      subj.faceRefs.unshift({
        filename: path.basename(saved[0].path),
        url: saved[0].url,
        generated: true,
        generatedAt: new Date().toISOString()
      });
    }

    subj.status = body?.previewOnly ? "awaiting-approval" : "generated";
    fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));

    return NextResponse.json({ ok: true, images: saved, subject: subj });
  } catch (err) {
    console.error("generate-face route error:", err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
