import fs from "fs";
import path from "path";
import Replicate from "replicate";
import { NextResponse } from "next/server";

const ROOT = process.cwd();
const SUBJECT_DIR = path.join(ROOT, "data", "subjects");
const GENERATED_DIR = path.join(ROOT, "public", "generated");
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

// Replicate client (reads REPLICATE_API_TOKEN)
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

function extToMime(filePath) {
  const ext = (path.extname(filePath) || "").toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

/**
 * Convert a local file (absolute or relative under public/) to data URI
 */
/**
 * fileToDataUri: convert a local file to data URI 'data:<mime>;base64,...'
 * Accepts:
 *  - "/generated/foo.png"           -> resolves to <ROOT>/public/generated/foo.png
 *  - "generated/foo.png"            -> resolves to <ROOT>/public/generated/foo.png
 *  - "public/generated/foo.png"     -> resolves to <ROOT>/public/generated/foo.png
 *  - absolute path under project    -> used as-is if exists and inside project
 * Returns data URI string or null if file not found.
 */
function fileToDataUri(filePath) {
    // quick guard
    if (!filePath || typeof filePath !== "string") return null;
  
    // normalize input: strip leading slash for relative/public lookup
    const relCandidate = filePath.replace(/^\//, "");
  
    // Candidate absolute paths to try (in order)
    const candidates = [];
  
    // 1) If given an absolute path that looks like it's inside the project root, try it first
    if (path.isAbsolute(filePath)) {
      // If it's already within the project root, use it
      if (filePath.startsWith(ROOT)) {
        candidates.push(filePath);
      } else {
        // If it's absolute but not under ROOT, also still try it (maybe user passed absolute)
        candidates.push(filePath);
        // Also try mapping the basename into public (fallback)
        candidates.push(path.join(ROOT, "public", path.basename(filePath)));
      }
    }
  
    // 2) public/<relCandidate>
    candidates.push(path.join(ROOT, "public", relCandidate));
  
    // 3) treat it as a path relative to project root (cwd)
    candidates.push(path.join(ROOT, relCandidate));
  
    // 4) try exactly as given (in case it's already a fs path without leading slash)
    candidates.push(filePath);
  
    // try candidates and pick the first existing file
    let abs = null;
    for (const c of candidates) {
      try {
        if (fs.existsSync(c)) {
          abs = c;
          break;
        }
      } catch (e) {
        // ignore
      }
    }
  
    if (!abs) {
      // not found
      console.warn(`fileToDataUri: file not found for '${filePath}', tried: ${JSON.stringify(candidates)}`);
      return null;
    }
  
    // read / convert
    const buf = fs.readFileSync(abs);
    const mime = extToMime(abs);
    const b64 = buf.toString("base64");
    return `data:${mime};base64,${b64}`;
  }

// near the top of the file, before normalizeImageInputs:
const APP_BASE = (process.env.APP_BASE_URL || "").trim();
// treat APP_BASE as public only if it is set and not localhost/127.0.0.1/0.0.0.0
const appBaseIsPublic = APP_BASE && !/^https?:\/\/(localhost|127(?:\.\d+){0,2}\.\d+|0\.0\.0\.0)(:\d+)?/i.test(APP_BASE);

/**
 * Normalize image_input array so that each item is a valid URI:
 * - keep https? and data: URIs as-is
 * - if item is a relative public path (/generated/...), convert to data: URI (or full URL if APP_BASE_URL set)
 * - if item is a local fs path -> convert to data: URI
 */
async function normalizeImageInputs(inputs = []) {
    if (!Array.isArray(inputs)) return [];
  
    const out = [];
    for (const raw of inputs) {
      if (!raw) continue;
      let uri = raw;
      if (typeof raw === "object" && raw.url) uri = raw.url;
      if (typeof uri !== "string") continue;
  
      // already data URI
      if (uri.startsWith("data:")) {
        out.push(uri);
        continue;
      }
  
      // absolute HTTP(S)
      if (/^https?:\/\//i.test(uri)) {
        out.push(uri);
        continue;
      }
  
      // If APP_BASE_URL is present AND is public (not localhost), make an absolute URL
      if (appBaseIsPublic && uri.startsWith("/")) {
        out.push(`${APP_BASE.replace(/\/$/, "")}${uri}`);
        continue;
      }
  
      // Otherwise, convert local/public file into a data URI
      const dataUri = fileToDataUri(uri);
        if (dataUri) {
        out.push(dataUri);
        continue;
        } else {
        console.warn(`normalizeImageInputs: could not convert input '${uri}' to a data URI or public URL`);
        continue;
        }
  
      // fallback: if looks like "generated/foo.png" try public path
      if (!uri.startsWith("/") && fs.existsSync(path.join(ROOT, "public", uri))) {
        const data = fileToDataUri(`/${uri}`);
        if (data) { out.push(data); continue; }
      }
  
      // could not normalize; skip
    }
    return out;
  }

/**
 * Extract possible outputs from replicate.run result.
 * Supports strings, arrays, objects with .url/.output fields and functions like .url()
 * Returns array of items: { type: "url"|"data"|"base64", value: string }
 */
async function extractOutputsAsync(out) {
  const results = [];
  if (!out) return results;

  // string
  if (typeof out === "string") {
    if (out.startsWith("data:")) results.push({ type: "data", value: out });
    else if (/^https?:\/\//i.test(out)) results.push({ type: "url", value: out });
    else results.push({ type: "string", value: out });
    return results;
  }

  // array -> recurse
  if (Array.isArray(out)) {
    for (const e of out) {
      results.push(...(await extractOutputsAsync(e)));
    }
    return results;
  }

  // function -> call it (some SDKs return functions like .url())
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

  // object -> inspect common properties
  if (typeof out === "object") {
    if (out.url) {
      if (typeof out.url === "function") {
        try {
          const val = out.url();
          const awaited = val instanceof Promise ? await val : val;
          results.push(...(await extractOutputsAsync(awaited)));
        } catch (e) {
          console.warn("extractOutputs: out.url() failed", e);
        }
      } else {
        results.push(...(await extractOutputsAsync(out.url)));
      }
    }
    if (out.output) results.push(...(await extractOutputsAsync(out.output)));
    if (out.image) results.push(...(await extractOutputsAsync(out.image)));
    if (out.result) results.push(...(await extractOutputsAsync(out.result)));

    if (out.base64 || out.b64) {
      const b64 = out.base64 || out.b64;
      if (typeof b64 === "string") results.push({ type: "base64", value: b64 });
    }

    // final fallback: try to find urls inside JSON string
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
 * Save an extracted output item (url/data/base64) to /public/generated and return { url: publicUrl, path, source }
 */
async function saveExtractedItem(item, id, index) {
  if (!item) return null;
  const fname = `nb-${id}-${Date.now()}-${index}.png`;
  const outPath = path.join(GENERATED_DIR, fname);

  if (item.type === "url") {
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

  if (item.type === "string") {
    // try to see if string contains a url
    if (/^https?:\/\//i.test(item.value)) {
      return await saveExtractedItem({ type: "url", value: item.value }, id, index);
    }
    return null;
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

    // Normalize image inputs
    const rawInputs = Array.isArray(body?.image_input) ? body.image_input : [];
    const image_input = await normalizeImageInputs(rawInputs);

    // Build replicate input
    const input = {};
    if (body?.prompt) input.prompt = body.prompt;
    if (image_input.length) input.image_input = image_input;
    if (body?.settings && typeof body.settings === "object") {
      Object.keys(body.settings).forEach((k) => {
        if (body.settings[k] !== undefined && body.settings[k] !== null) input[k] = body.settings[k];
      });
    }
    if (!input.prompt && !input.image_input) {
      input.prompt = subj.basePrompt || subj.description || "Photorealistic close-up portrait, neutral expression, studio lighting.";
    }

    const modelId = process.env.REPLICATE_MODEL_NAME || "google/nano-banana";
    console.log("Calling Replicate.run model=", modelId, "input keys:", Object.keys(input));

    let rawOutput;
    try {
      rawOutput = await replicate.run(modelId, { input });
      console.log("Replicate raw output received");
    } catch (e) {
      console.error("Replicate.run error:", e);
      return NextResponse.json({ error: "Replicate.run failed: " + String(e) }, { status: 500 });
    }

    // Extract outputs (async)
    const extracted = await extractOutputsAsync(rawOutput);
    if (!extracted || extracted.length === 0) {
      console.error("No extractable outputs from replicate:", rawOutput);
      return NextResponse.json({ error: "Replicate returned no image outputs", raw: rawOutput }, { status: 500 });
    }

    // Save extracted outputs
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
      return NextResponse.json({ error: "Failed to download/save outputs from Replicate", raw: rawOutput, extracted }, { status: 500 });
    }

    // Update subject assets & optionally add generated faceRef
    subj.assets = subj.assets || [];
    for (const s of saved) {
      subj.assets.push({
        type: "generated_face_replicate",
        url: s.url,
        createdAt: new Date().toISOString(),
        meta: { model: modelId, prompt: input.prompt || null, source: s.source || null }
      });
    }
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
