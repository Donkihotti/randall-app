// src/app/api/subject/[id]/generate-model-sheet/route.js
import fs from "fs";
import path from "path";
import Replicate from "replicate";
import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

const ROOT = process.cwd();
const SUBJECT_DIR = path.join(ROOT, "data", "subjects");
const GENERATED_DIR = path.join(ROOT, "public", "generated");
const TEMP_DIR = path.join(ROOT, "tmp");
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Replicate client
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

// small helper
function extToMime(filePath) {
  const ext = (path.extname(filePath) || "").toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

/** convert a local file (public/...) to data URI; returns null if not found */
function fileToDataUri(filePath) {
  if (!filePath || typeof filePath !== "string") return null;
  const relCandidate = filePath.replace(/^\//, "");
  const candidates = [
    path.join(ROOT, "public", relCandidate),
    path.join(ROOT, relCandidate),
    filePath
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const buf = fs.readFileSync(c);
      const mime = extToMime(c);
      return `data:${mime};base64,${buf.toString("base64")}`;
    }
  }
  return null;
}

/** small center-crop face crop similar to your worker helper */
async function makeCenterFaceCrop(filePath) {
  // lazy import sharp at runtime so route file is smaller by default
  const sharp = (await import("sharp")).default;
  const meta = await sharp(filePath).metadata();
  const size = Math.min(meta.width || 512, meta.height || 512);
  const left = Math.floor(((meta.width || size) - size) / 2);
  const top = Math.floor(((meta.height || size) - size) / 2);
  const outName = `facecrop-${uuidv4()}${path.extname(filePath)}`;
  const outPath = path.join(TEMP_DIR, outName);
  await sharp(filePath).extract({ left: Math.max(0, left), top: Math.max(0, top), width: size, height: size }).resize(1024, 1024, { fit: "cover" }).toFile(outPath);
  return outPath;
}

/**
 * extractOutputsAsync / saveExtractedItem helpers (robust to SDK shapes)
 */
async function extractOutputsAsync(out) {
  const results = [];
  if (!out) return results;
  if (typeof out === "string") {
    if (out.startsWith("data:")) results.push({ type: "data", value: out });
    else if (/^https?:\/\//i.test(out)) results.push({ type: "url", value: out });
    else results.push({ type: "string", value: out });
    return results;
  }
  if (Array.isArray(out)) {
    for (const e of out) results.push(...(await extractOutputsAsync(e)));
    return results;
  }
  if (typeof out === "function") {
    try {
      const val = out();
      const awaited = val instanceof Promise ? await val : val;
      results.push(...(await extractOutputsAsync(awaited)));
    } catch (e) {
      console.warn("extractOutputs: function call failed", e);
    }
    return results;
  }
  if (typeof out === "object") {
    if (out.url) {
      if (typeof out.url === "function") {
        try {
          const v = out.url();
          const awaited = v instanceof Promise ? await v : v;
          results.push(...(await extractOutputsAsync(awaited)));
        } catch (e) { console.warn("call out.url() failed", e); }
      } else results.push(...(await extractOutputsAsync(out.url)));
    }
    if (out.output) results.push(...(await extractOutputsAsync(out.output)));
    if (out.image) results.push(...(await extractOutputsAsync(out.image)));
    if (out.result) results.push(...(await extractOutputsAsync(out.result)));
    if (out.base64 || out.b64) {
      const b = out.base64 || out.b64;
      if (typeof b === "string") results.push({ type: "base64", value: b });
    }
    try {
      const s = JSON.stringify(out);
      const found = s.match(/https?:\/\/[^\s"']+/g);
      if (found) for (const u of Array.from(new Set(found))) results.push({ type: "url", value: u });
    } catch (e) {}
  }
  return results;
}

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
    const parts = item.value.split(",");
    if (parts.length !== 2) throw new Error("Invalid data URI");
    fs.writeFileSync(outPath, Buffer.from(parts[1], "base64"));
    return { url: `/generated/${fname}`, path: outPath, source: "data-uri" };
  }
  if (item.type === "base64") {
    fs.writeFileSync(outPath, Buffer.from(item.value, "base64"));
    return { url: `/generated/${fname}`, path: outPath, source: "base64" };
  }
  if (item.type === "string") {
    if (/^https?:\/\//i.test(item.value)) return await saveExtractedItem({ type: "url", value: item.value }, id, index);
    return null;
  }
  return null;
}

/**
 * POST handler
 * Body: { previewOnly?:boolean, faceAngles?:[], faceSettings? }
 * Uses REPLICATE_MODEL_NAME env var or "google/nano-banana".
 */
export async function POST(req, context) {
  try {
    const params = context?.params;
    const resolvedParams = params && typeof params.then === "function" ? await params : params;
    const { id } = resolvedParams || {};
    if (!id) return NextResponse.json({ error: "Missing subject id" }, { status: 400 });

    const subjFile = path.join(SUBJECT_DIR, `${id}.json`);
    if (!fs.existsSync(subjFile)) return NextResponse.json({ error: "Subject not found" }, { status: 404 });

    const body = await req.json();
    const subj = JSON.parse(fs.readFileSync(subjFile, "utf8"));

    // faceAngles & settings
    const faceAngles = Array.isArray(body?.faceAngles) && body.faceAngles.length ? body.faceAngles : ["center","up-left","up","up-right","left","3q-left","3q-right","right","down"];
    const basePrompt = body?.promptOverride || subj.basePrompt || subj.description || "Photorealistic close-up portrait, neutral expression, studio lighting.";
    const modelId = process.env.REPLICATE_MODEL_NAME || "google/nano-banana";

    // create an optional face crop to use as image_input (if faceRef exists)
    let faceCropPath = null;
    if (subj.faceRefs && subj.faceRefs[0]) {
      try {
        const faceRefPath = subj.faceRefs[0].url.replace(/^\//, "");
        const faceFs = path.join(ROOT, "public", faceRefPath);
        if (fs.existsSync(faceFs)) {
          faceCropPath = await makeCenterFaceCrop(faceFs);
        } else {
          // try resolve other ways
          const possible = fileToDataUri(subj.faceRefs[0].url);
          // if possible is a data URI we still pass it as image_input directly later (no crop)
        }
      } catch (e) {
        console.warn("face crop failed", e);
      }
    }

    const savedAll = [];

    for (let i = 0; i < faceAngles.length; i++) {
      const angle = faceAngles[i];
      const anglePromptMap = {
        "center": "head facing the camera directly (0°)",
        "up-left": "head tilted up and left (15° up, 20° left)",
        "up": "head tilted up slightly (15° up)",
        "up-right": "head tilted up and right (15° up, 20° right)",
        "left": "head turned left (45°)",
        "3q-left": "3/4 left portrait (30° left)",
        "3q-right": "3/4 right portrait (30° right)",
        "right": "head turned right (45°)",
        "down": "head tilted down slightly (15° down)"
      };
      const angleText = anglePromptMap[angle] || `head pose: ${angle}`;
      const prompt = `${basePrompt} Close-up portrait, ${angleText}. Photorealistic, high detail, preserve identity and facial features. Neutral expression.`;

      // Build input for nano-banana: include image_input if we have face crop or subject faceRef
      const input = { prompt };
      if (faceCropPath && fs.existsSync(faceCropPath)) {
        // convert crop to data URI and pass as image_input
        const dataUri = fileToDataUri(faceCropPath);
        if (dataUri) input.image_input = [dataUri];
      } else if (subj.faceRefs && subj.faceRefs[0]) {
        // use public url (if available)
        input.image_input = [subj.faceRefs[0].url];
      }

      // copy optional settings
      if (body?.settings && typeof body.settings === "object") {
        Object.keys(body.settings).forEach((k) => {
          if (body.settings[k] !== undefined && body.settings[k] !== null) input[k] = body.settings[k];
        });
      }

      // call replicate
      let rawOutput;
      try {
        console.log("Replicate run for angle", angle, "input keys:", Object.keys(input));
        rawOutput = await replicate.run(modelId, { input });
      } catch (e) {
        console.error("Replicate.run error for angle", angle, e);
        subj.warnings = subj.warnings || [];
        subj.warnings.push(`Replicate error for angle ${angle}: ${String(e)}`);
        fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));
        continue; // try next angle
      }

      const extracted = await extractOutputsAsync(rawOutput);
      const saved = [];
      for (let j = 0; j < extracted.length; j++) {
        try {
          const s = await saveExtractedItem(extracted[j], id, `${i}-${j}`);
          if (s) saved.push(s);
        } catch (e) {
          console.warn("Failed save for angle", angle, e);
        }
      }

      // add saved outputs to subject assets
      if (saved.length) {
        subj.assets = subj.assets || [];
        for (const s of saved) {
          subj.assets.push({
            type: "sheet_face",
            angle,
            url: s.url,
            createdAt: new Date().toISOString(),
            meta: { prompt, model: modelId, source: s.source || null }
          });
          savedAll.push(s);
        }

        // add first saved image as a faceRef so flow can continue using it as reference
        subj.faceRefs = subj.faceRefs || [];
        subj.faceRefs.unshift({
          filename: path.basename(saved[0].path),
          url: saved[0].url,
          generated: true,
          generatedAt: new Date().toISOString()
        });

        fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));
      } else {
        subj.warnings = subj.warnings || [];
        subj.warnings.push(`No outputs for face angle ${angle}`);
        fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));
      }
    } // end for angles

    // final status
    subj.status = body?.previewOnly ? "awaiting-approval" : "sheet_generated";
    fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));

    return NextResponse.json({ ok: true, saved: savedAll, subject: subj });
  } catch (err) {
    console.error("generate-model-sheet route error:", err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
