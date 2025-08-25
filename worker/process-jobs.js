// worker/process-jobs.js
// Full worker with InstantID adapter for Replicate + simple center face-crop.
// Requirements:
//   npm install sharp node-fetch uuid
// Env needed when running the worker:
//   REPLICATE_API_TOKEN          (your Replicate API token)
//   REPLICATE_MODEL_NAME        (e.g. "tgohblio/instant-id-multicontrolnet")
//   REPLICATE_MODEL_VERSION     (the version id/hash from Replicate Versions tab — or "model:version" string)
// Notes:
//   - If you're on Node 18+ you can remove the 'node-fetch' import and use global fetch.

import fs from "fs";
import path from "path";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";

const ROOT = process.cwd();
const JOB_DIR = path.join(ROOT, "data", "jobs");
const SUBJECT_DIR = path.join(ROOT, "data", "subjects");
const UPLOAD_DIR = path.join(ROOT, "public", "uploads");
const GENERATED_DIR = path.join(ROOT, "public", "generated");
const TEMP_DIR = path.join(ROOT, "tmp");

// helper: resolve uploaded file url to an on-disk path (handles /uploads/... and /public/uploads/...)
function resolveUploadFile(urlPath) {
    if (!urlPath) return null;
    // strip leading slash if present
    const rel = urlPath.replace(/^\//, "");
  
    // Common case: "/uploads/xxx" -> public/uploads/xxx
    const pPublic = path.join(ROOT, "public", rel);
    if (fs.existsSync(pPublic)) return pPublic;
  
    // Fallback: user maybe stored "uploads/xxx" or "public/uploads/xxx" already
    const p1 = path.join(ROOT, rel);
    if (fs.existsSync(p1)) return p1;
  
    // Another fallback: if they had leading public/ path
    const p2 = path.join(ROOT, "public", path.basename(rel));
    if (fs.existsSync(p2)) return p2;
  
    // last resort: attempt decode/space variants
    try {
      const dec = decodeURIComponent(rel);
      const pDec = path.join(ROOT, "public", dec);
      if (fs.existsSync(pDec)) return pDec;
    } catch (e) {}
  
    // not found: return primary expected path (for clearer logs)
    return pPublic;
  }
  

// ensure directories exist
for (const d of [JOB_DIR, SUBJECT_DIR, UPLOAD_DIR, GENERATED_DIR, TEMP_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function listJobs() {
  return fs.readdirSync(JOB_DIR).filter((f) => f.endsWith(".json"));
}

async function processJobFile(jobFile) {
  const jobPath = path.join(JOB_DIR, jobFile);
  let job;
  try {
    job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
  } catch (e) {
    console.error("Failed to parse job", jobFile, e);
    return;
  }

  console.log("Processing job:", job.id, job.type);

  // mark running
  job.status = "running";
  fs.writeFileSync(jobPath, JSON.stringify(job, null, 2));

  try {
    if (job.type === "preprocess") {
      await handlePreprocess(job);
    } else if (job.type === "generate-views") {
      await handleGenerateViews(job);
    } else if (job.type === "generate-model-sheet") {
      await handleGenerateModelSheet(job);
    } else {
      console.warn("Unknown job type:", job.type);
    }
    job.status = "done";
  } catch (err) {
    console.error("Job error:", job.id, err);
    job.status = "failed";
    job.error = String(err);
  }

  job.finishedAt = new Date().toISOString();
  fs.writeFileSync(jobPath, JSON.stringify(job, null, 2));
}

/* ------------------ PREPROCESS ------------------ */

async function handlePreprocess(job) {
  const subjectId = job.subjectId;
  const subjFile = path.join(SUBJECT_DIR, `${subjectId}.json`);
  if (!fs.existsSync(subjFile)) throw new Error("Subject not found for preprocess: " + subjectId);
  const subj = JSON.parse(fs.readFileSync(subjFile, "utf8"));

  subj.assets = subj.assets || [];

  // face thumbnails
  for (const face of subj.faceRefs || []) {
    try {
      const inFile = resolveUploadFile(face.url);
      if (!fs.existsSync(inFile)) {
        subj.warnings = subj.warnings || [];
        subj.warnings.push(`Face ref file not found: ${face.url}`);
        continue;
      }
      const thumbName = `thumb-${subjectId}-${path.basename(face.filename)}`;
      const outPath = path.join(UPLOAD_DIR, thumbName);
      await sharp(inFile).resize(256, 256, { fit: "cover" }).toFile(outPath);
      subj.assets.push({ type: "thumb_face", url: `/uploads/${thumbName}`, origin: face.url });
    } catch (e) {
      console.warn("Failed to thumb face:", e);
    }
  }

  // body thumbnails
  for (const body of subj.bodyRefs || []) {
    try {
      const inFile = resolveUploadFile(body.url);
      if (!fs.existsSync(inFile)) {
        subj.warnings = subj.warnings || [];
        subj.warnings.push(`Body ref file not found: ${body.url}`);
        continue;
      }
      const thumbName = `thumb-${subjectId}-${path.basename(body.filename)}`;
      const outPath = path.join(UPLOAD_DIR, thumbName);
      await sharp(inFile).resize(512, 512, { fit: "cover" }).toFile(outPath);
      subj.assets.push({ type: "thumb_body", url: `/uploads/${thumbName}`, origin: body.url });
    } catch (e) {
      console.warn("Failed to thumb body:", e);
    }
  }

  // TODO: add pose map generation and face embedding here (call a microservice)
  subj.status = "awaiting-approval";
  fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));
  console.log("Preprocess finished for", subjectId);
}

/* ------------------ GENERATE VIEWS (uses unified adapter) ------------------ */

async function handleGenerateViews(job) {
  const subjectId = job.subjectId;
  const subjFile = path.join(SUBJECT_DIR, `${subjectId}.json`);
  if (!fs.existsSync(subjFile)) throw new Error("Subject not found for generate-views: " + subjectId);
  const subj = JSON.parse(fs.readFileSync(subjFile, "utf8"));

  const views = job.payload?.views || ["front", "left", "right"];
  subj.assets = subj.assets || [];

  const source = (subj.bodyRefs && subj.bodyRefs[0]) || (subj.faceRefs && subj.faceRefs[0]) || null;
  if (!source) {
    subj.warnings = subj.warnings || [];
    subj.warnings.push("No reference image to generate views from.");
    fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));
    return;
  }
  const inFile = resolveUploadFile(source.url);
  if (!fs.existsSync(inFile)) {
    subj.warnings = subj.warnings || [];
    subj.warnings.push("Reference file missing for generation: " + source.url);
    fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));
    return;
  }

  const baseImageDataUri = await fileToDataUri(inFile);

  // attempt to create a quick face crop (center crop) for InstantID if faceRef exists
  let faceCropDataUri = null;
  if (subj.faceRefs && subj.faceRefs[0]) {
    try {
      const faceFile = resolveUploadFile(subj.faceRefs[0].url);
      if (fs.existsSync(faceFile)) {
        const cropPath = await makeCenterFaceCrop(faceFile);
        faceCropDataUri = await fileToDataUri(cropPath);
      }
    } catch (e) {
      console.warn("face crop failed:", e);
    }
  }

  // fallback control image - we do not have pose maps yet
  const controlImageDataUri = baseImageDataUri;

  const basePrompt = subj.basePrompt || (subj.description || "Photorealistic photograph of the same person, keep identity consistent.");

  for (const view of views) {
    const prompt = `${basePrompt} View: ${view}. Photorealistic, studio lighting, high detail. Keep facial identity and clothing details consistent with the reference.`;
    try {
      const outputs = await generateWithReplicateUnified({
        prompt,
        negative_prompt: "",
        imageDataUri: baseImageDataUri,
        controlDataUri: controlImageDataUri,
        faceDataUri: faceCropDataUri,
        settings: {
          steps: job.payload?.steps ?? 20,
          guidance_scale: job.payload?.guidance_scale ?? 7.5,
          prompt_strength: job.payload?.prompt_strength ?? 0.6,
          num_outputs: job.payload?.num_outputs ?? 1,
          seed: job.payload?.seed ?? null
        }
      });

      if (!Array.isArray(outputs) || outputs.length === 0) {
        subj.warnings = subj.warnings || [];
        subj.warnings.push(`Replicate returned no images for view ${view}`);
        continue;
      }

      for (let i = 0; i < outputs.length; i++) {
        const out = outputs[i];
        const buffer = await normalizeOutputToBuffer(out);
        const outName = `rep-${subjectId}-${view}-${Date.now()}-${i}.png`;
        fs.writeFileSync(path.join(GENERATED_DIR, outName), buffer);
        subj.assets.push({ type: "preview", view, url: `/generated/${outName}`, generatedAt: new Date().toISOString(), source: source.url });
        console.log("Saved generated preview:", outName);
      }
      fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));
    } catch (err) {
      console.error("Replicate generation error for view", view, err);
      subj.warnings = subj.warnings || [];
      subj.warnings.push(`Generation failed for view ${view}: ${String(err)}`);
      fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));
    }
  }

  subj.status = job.payload?.previewOnly ? "awaiting-approval" : "generated";
  fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));
  console.log("Generate-views finished for", subjectId);
}

/* ------------------ GENERATE MODEL SHEET (bodies + faces) ------------------ */

async function handleGenerateModelSheet(job) {
  const subjectId = job.subjectId;
  const subjFile = path.join(SUBJECT_DIR, `${subjectId}.json`);
  if (!fs.existsSync(subjFile)) throw new Error("Subject not found for generate-model-sheet: " + subjectId);
  const subj = JSON.parse(fs.readFileSync(subjFile, "utf8"));
  subj.assets = subj.assets || [];

  const bodyRef = (subj.bodyRefs && subj.bodyRefs[0]) || null;
  const faceRef = (subj.faceRefs && subj.faceRefs[0]) || null;

  const bodyAngles = job.payload?.bodyAngles || ["front", "3q-left", "3q-right", "back"];
  const faceAngles = job.payload?.faceAngles || ["center","up-left","up","up-right","left","3q-left","3q-right","right","down"];
  const basePrompt = subj.basePrompt || (subj.description || "Photorealistic photograph of the same person, keep identity consistent.");

  // create face crop if we have a face ref (used for InstantID)
  let faceCropDataUri = null;
  if (faceRef) {
    try {
      const faceFile = resolveUploadFile(faceRef.url);
      if (fs.existsSync(faceFile)) {
        const cropPath = await makeCenterFaceCrop(faceFile);
        faceCropDataUri = await fileToDataUri(cropPath);
      }
    } catch (e) {
      console.warn("face crop creation failed:", e);
    }
  }

  // Body sheet
  if (bodyRef) {
    const inFile = resolveUploadFile(bodyRef.url);
    if (!fs.existsSync(inFile)) {
      subj.warnings = subj.warnings || [];
      subj.warnings.push("Body reference missing for model-sheet generation.");
    } else {
      for (const view of bodyAngles) {
        const prompt = `${basePrompt} Full body view: ${view}. Photorealistic, consistent identity, neutral studio lighting. Camera framing: full body.`;
        try {
          const outs = await generateWithReplicateUnified({
            prompt,
            negative_prompt: "",
            imageDataUri: await fileToDataUri(inFile),
            controlDataUri: null,
            faceDataUri: faceCropDataUri,
            settings: {
              prompt_strength: job.payload?.settings?.bodyPromptStrength ?? 0.45,
              guidance_scale: job.payload?.settings?.bodyGuidance ?? 7.5,
              steps: job.payload?.settings?.bodySteps ?? 20,
              num_outputs: 1
            }
          });

          if (Array.isArray(outs) && outs.length) {
            for (let i = 0; i < outs.length; i++) {
              const buffer = await normalizeOutputToBuffer(outs[i]);
              const outName = `sheet-body-${subjectId}-${view}-${Date.now()}-${i}.png`;
              fs.writeFileSync(path.join(GENERATED_DIR, outName), buffer);
              subj.assets.push({ type: "sheet_body", view, url: `/generated/${outName}`, generatedAt: new Date().toISOString(), meta: { view, source: bodyRef.url }});
              console.log("Saved body sheet:", outName);
            }
          } else {
            subj.warnings = subj.warnings || [];
            subj.warnings.push(`No outputs for body view ${view}`);
          }
          fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));
        } catch (err) {
          console.error("Error generating body view", view, err);
          subj.warnings = subj.warnings || [];
          subj.warnings.push(`Error generating body ${view}: ${String(err)}`);
          fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));
        }
      }
    }
  }

  // Face sheet
  if (faceRef) {
    const inFile = resolveUploadFile(faceRef.url);
    if (!fs.existsSync(inFile)) {
      subj.warnings = subj.warnings || [];
      subj.warnings.push("Face reference missing for model-sheet generation.");
    } else {
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

      for (const angle of faceAngles) {
        const angleText = anglePromptMap[angle] || `head pose: ${angle}`;
        const prompt = `${basePrompt} Close-up portrait, ${angleText}. Photorealistic, high detail, preserve identity and facial features. Neutral expression.`;
        try {
          const outs = await generateWithReplicateUnified({
            prompt,
            negative_prompt: "",
            imageDataUri: await fileToDataUri(inFile),
            controlDataUri: null,
            faceDataUri: faceCropDataUri,
            settings: {
              prompt_strength: job.payload?.settings?.facePromptStrength ?? 0.35,
              guidance_scale: job.payload?.settings?.faceGuidance ?? 7.0,
              steps: job.payload?.settings?.faceSteps ?? 20,
              num_outputs: 1
            }
          });

          if (Array.isArray(outs) && outs.length) {
            for (let i = 0; i < outs.length; i++) {
              const buffer = await normalizeOutputToBuffer(outs[i]);
              const outName = `sheet-face-${subjectId}-${angle}-${Date.now()}-${i}.png`;
              fs.writeFileSync(path.join(GENERATED_DIR, outName), buffer);
              subj.assets.push({ type: "sheet_face", angle, url: `/generated/${outName}`, generatedAt: new Date().toISOString(), meta: { angle, source: faceRef.url }});
              console.log("Saved face sheet:", outName);
            }
          } else {
            subj.warnings = subj.warnings || [];
            subj.warnings.push(`No outputs for face angle ${angle}`);
          }
          fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));
        } catch (err) {
          console.error("Error generating face angle", angle, err);
          subj.warnings = subj.warnings || [];
          subj.warnings.push(`Error generating face angle ${angle}: ${String(err)}`);
          fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));
        }
      }
    }
  }

  subj.status = job.payload?.previewOnly ? "awaiting-approval" : "sheet_generated";
  fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));
  console.log("Model sheet generation complete for", subjectId);
}

/* ------------------ Helpers ------------------ */

async function normalizeOutputToBuffer(out) {
  if (typeof out === "string" && out.startsWith("data:image")) {
    return Buffer.from(out.split(",")[1], "base64");
  }
  if (typeof out === "string" && (out.startsWith("http://") || out.startsWith("https://"))) {
    const r = await fetch(out);
    const arr = new Uint8Array(await r.arrayBuffer());
    return Buffer.from(arr);
  }
  if (out && out.base64) {
    return Buffer.from(out.base64, "base64");
  }
  throw new Error("Unknown replicate output format");
}

/**
 * fileToDataUri: convert a local file to data URI 'data:<mime>;base64,...'
 */
async function fileToDataUri(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".png" ? "image/png" : "application/octet-stream";
  const buf = fs.readFileSync(filePath);
  const b64 = buf.toString("base64");
  return `data:${mime};base64,${b64}`;
}

/**
 * makeCenterFaceCrop:
 *  - a simple heuristic to crop the center square of the face image to produce a face crop.
 *  - This is a fallback for now; replace with real face detection for best results.
 *  - Returns path to cropped image file in tmp dir.
 */
async function makeCenterFaceCrop(filePath) {
  const outName = `facecrop-${uuidv4()}${path.extname(filePath)}`;
  const outPath = path.join(TEMP_DIR, outName);

  // use sharp: get metadata, compute center square, resize to 1024x1024 (or keep original ratio)
  const meta = await sharp(filePath).metadata();
  const size = Math.min(meta.width || 512, meta.height || 512);
  const left = Math.floor(((meta.width || size) - size) / 2);
  const top = Math.floor(((meta.height || size) - size) / 2);

  await sharp(filePath).extract({ left: Math.max(0, left), top: Math.max(0, top), width: size, height: size }).resize(1024, 1024, { fit: "cover" }).toFile(outPath);
  return outPath;
}

/* ---------- Replicate helpers (InstantID-aware) ---------- */

/**
 * generateWithReplicateUnified:
 *  - single entry point to call Replicate.
 *  - If REPLICATE_MODEL_NAME includes 'instant-id' it will construct InstantID-like input fields.
 *  - Accepts either faceDataUri (string) or imageDataUri + controlDataUri for generic models.
 */
async function generateWithReplicateUnified({
  prompt,
  negative_prompt,
  imageDataUri,
  controlDataUri,
  faceDataUri,
  faceDataUri2,
  faceDataUri3,
  faceDataUri4,
  poseDataUri,
  settings = {}
}) {
  const modelName = (process.env.REPLICATE_MODEL_NAME || "").toLowerCase();
  const isInstantId = modelName.includes("instant-id");

  if (isInstantId) {
    const inputObj = {
      prompt: prompt || "a person",
      negative_prompt: negative_prompt || "",
      // InstantID expects keys like face_image_path etc. We pass data URIs here.
      face_image_path: faceDataUri || imageDataUri || null,
      face_image_path2: faceDataUri2 || null,
      face_image_path3: faceDataUri3 || null,
      face_image_path4: faceDataUri4 || null,
      pose_image_path: poseDataUri || controlDataUri || null,
      num_inference_steps: settings.steps ?? 20,
      guidance_scale: settings.guidance_scale ?? 7.5,
      seed: settings.seed ?? null
    };
    // drop nulls
    Object.keys(inputObj).forEach(k => inputObj[k] === null && delete inputObj[k]);
    return await replicateCreateAndPoll(inputObj);
  } else {
    // generic SD/ControlNet style
    const inputObj = {
      prompt: prompt || "a person",
      image: imageDataUri || faceDataUri || null,
      control_image: controlDataUri || poseDataUri || null,
      prompt_strength: settings.prompt_strength ?? 0.6,
      guidance_scale: settings.guidance_scale ?? 7.5,
      num_inference_steps: settings.steps ?? 20,
      num_outputs: settings.num_outputs ?? 1,
      seed: settings.seed ?? null
    };
    Object.keys(inputObj).forEach(k => inputObj[k] === null && delete inputObj[k]);
    return await replicateCreateAndPoll(inputObj);
  }
}

/**
 * replicateCreateAndPoll: create a Replicate prediction and poll until finished
 * Accepts env REPLICATE_API_TOKEN and REPLICATE_MODEL_VERSION (either a full "model:version" or just version hash).
 */
async function replicateCreateAndPoll(input) {
  const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
  let REPLICATE_MODEL_VERSION = process.env.REPLICATE_MODEL_VERSION || "";
  if (!REPLICATE_API_TOKEN || !REPLICATE_MODEL_VERSION) {
    throw new Error("Set REPLICATE_API_TOKEN and REPLICATE_MODEL_VERSION in env");
  }

  // Accept either "model:version" or just the version hash. If user set "model:version", extract version part.
  // Also accept "tgohblio/instant-id-multicontrolnet:35324a7d..." etc.
  if (REPLICATE_MODEL_VERSION.includes(":")) {
    REPLICATE_MODEL_VERSION = REPLICATE_MODEL_VERSION.split(":").pop();
  }
  if (REPLICATE_MODEL_VERSION.includes("/")) {
    // if user accidentally pasted a URL-like string, try to get last segment
    REPLICATE_MODEL_VERSION = REPLICATE_MODEL_VERSION.split("/").pop();
  }

  const createResp = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${REPLICATE_API_TOKEN}`,
    },
    body: JSON.stringify({
      version: REPLICATE_MODEL_VERSION,
      input
    }),
  });

  if (!createResp.ok) {
    const txt = await createResp.text();
    throw new Error(`Replicate create prediction failed: ${createResp.status} ${txt}`);
  }
  const createJson = await createResp.json();
  const predictionId = createJson.id;
  const statusUrl = `https://api.replicate.com/v1/predictions/${predictionId}`;

  console.log("Replicate prediction created:", predictionId);

  while (true) {
    await new Promise((r) => setTimeout(r, 2500));
    const pollResp = await fetch(statusUrl, { headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` } });
    if (!pollResp.ok) {
      const t = await pollResp.text();
      throw new Error(`Replicate poll failed: ${pollResp.status} ${t}`);
    }
    const pollJson = await pollResp.json();
    if (pollJson.status === "succeeded") {
      return pollJson.output;
    }
    if (pollJson.status === "failed") {
      throw new Error(`Replicate failed: ${JSON.stringify(pollJson.error || pollJson)}`);
    }
    console.log("Replicate status:", pollJson.status);
  }
}

/* ------------------ Poll loop ------------------ */

async function pollLoop() {
  console.log("Worker started - polling for jobs in data/jobs/");
  while (true) {
    try {
      const jobs = listJobs();
      for (const jfile of jobs) {
        const jobPath = path.join(JOB_DIR, jfile);
        const raw = fs.readFileSync(jobPath, "utf8");
        const job = JSON.parse(raw);
        if (job.status && ["running", "done"].includes(job.status)) continue;
        await processJobFile(jfile);
      }
    } catch (err) {
      console.error("Worker loop error:", err);
    }
    await new Promise((res) => setTimeout(res, 2500));
  }
}

pollLoop();
