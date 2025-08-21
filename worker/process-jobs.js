// worker/process-jobs.js
// Worker with Replicate ControlNet img2img integration for generate-views jobs.
//
// Requirements:
//   npm install sharp node-fetch
//
// Environment:
//   REPLICATE_API_TOKEN set to your Replicate API token
//   REPLICATE_MODEL_VERSION set to the Replicate model version id (a hash) for a ControlNet img2img model
//
// Notes:
//  - Many Replicate ControlNet models accept fields like `image` (init image),
//    `control_image` (conditioning/control map), `prompt`, `prompt_strength`, `num_inference_steps`, `guidance_scale`.
//    If you pick a model which names things differently, adapt the `input` object below.

import fs from "fs";
import path from "path";
import sharp from "sharp";
import fetch from "node-fetch"; // npm i node-fetch@2 if using older Node

const JOB_DIR = path.join(process.cwd(), "data", "jobs");
const SUBJECT_DIR = path.join(process.cwd(), "data", "subjects");
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const GENERATED_DIR = path.join(process.cwd(), "public", "generated");

// ensure dirs exist
for (const d of [JOB_DIR, SUBJECT_DIR, UPLOAD_DIR, GENERATED_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function listJobs() {
  return fs.readdirSync(JOB_DIR).filter(f => f.endsWith(".json"));
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

/* ---------- PREPROCESS (unchanged from earlier) ---------- */
async function handlePreprocess(job) {
  const subjectId = job.subjectId;
  const subjFile = path.join(SUBJECT_DIR, `${subjectId}.json`);
  if (!fs.existsSync(subjFile)) throw new Error("Subject not found for preprocess: " + subjectId);
  const subj = JSON.parse(fs.readFileSync(subjFile, "utf8"));

  // Create thumbnails for faceRefs and bodyRefs
  subj.assets = subj.assets || [];
  for (const face of subj.faceRefs || []) {
    const inFile = path.join(process.cwd(), face.url.replace(/^\//, "")); // "/uploads/xxx"
    if (!fs.existsSync(inFile)) {
      subj.warnings = subj.warnings || [];
      subj.warnings.push(`Face ref file not found: ${face.url}`);
      continue;
    }
    const thumbName = `thumb-${subjectId}-${path.basename(face.filename)}`;
    const outPath = path.join(process.cwd(), "public", "uploads", thumbName);
    await sharp(inFile).resize(256, 256, { fit: "cover" }).toFile(outPath);
    subj.assets.push({ type: "thumb_face", url: `/uploads/${thumbName}`, origin: face.url });
  }

  for (const body of subj.bodyRefs || []) {
    const inFile = path.join(process.cwd(), body.url.replace(/^\//, ""));
    if (!fs.existsSync(inFile)) {
      subj.warnings = subj.warnings || [];
      subj.warnings.push(`Body ref file not found: ${body.url}`);
      continue;
    }
    const thumbName = `thumb-${subjectId}-${path.basename(body.filename)}`;
    const outPath = path.join(process.cwd(), "public", "uploads", thumbName);
    await sharp(inFile).resize(512, 512, { fit: "cover" }).toFile(outPath);
    subj.assets.push({ type: "thumb_body", url: `/uploads/${thumbName}`, origin: body.url });
  }

  // TODO: insert real pose estimation and face embedding calls here.
  // Example: call a python microservice to compute DensePose / OpenPose maps and face embedding,
  // save results to subj.assets with type 'pose_map' and 'face_embedding'.

  subj.status = "awaiting-approval"; // after preprocess the user can approve or request auto-views
  fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));
  console.log("Preprocess finished for", subjectId);
}

/* ---------- GENERATE VIEWS (REPLICATE integration) ---------- */

async function handleGenerateViews(job) {
  const subjectId = job.subjectId;
  const subjFile = path.join(SUBJECT_DIR, `${subjectId}.json`);
  if (!fs.existsSync(subjFile)) throw new Error("Subject not found for generate-views: " + subjectId);
  const subj = JSON.parse(fs.readFileSync(subjFile, "utf8"));

  const views = job.payload?.views || ["front", "left", "right"];
  subj.assets = subj.assets || [];

  // Source image -> choose first bodyRef if present, otherwise first faceRef
  const source = (subj.bodyRefs && subj.bodyRefs[0]) || (subj.faceRefs && subj.faceRefs[0]) || null;
  if (!source) {
    subj.warnings = subj.warnings || [];
    subj.warnings.push("No reference image to generate views from.");
    fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));
    return;
  }
  const inFile = path.join(process.cwd(), source.url.replace(/^\//, ""));
  if (!fs.existsSync(inFile)) {
    subj.warnings = subj.warnings || [];
    subj.warnings.push("Reference file missing for generation: " + source.url);
    fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));
    return;
  }

  // Read source image into data URI (base64) so Replicate can accept it directly
  const baseImageDataUri = await fileToDataUri(inFile);

  // If you have a pose map asset produced in preprocess, use that as control_image.
  // Otherwise we fall back to using the source image itself as a naive control image.
  // Best: replace with a proper pose_map (OpenPose/DensePose) image stored in subj.assets.
  const poseAsset = (subj.assets || []).find(a => a.type === "pose_map");
  let controlImageDataUri = null;
  if (poseAsset && poseAsset.url) {
    const poseFile = path.join(process.cwd(), poseAsset.url.replace(/^\//, ""));
    if (fs.existsSync(poseFile)) controlImageDataUri = await fileToDataUri(poseFile);
  }
  if (!controlImageDataUri) {
    // fallback
    controlImageDataUri = baseImageDataUri;
  }

  // Build prompt base — you can adapt this template
  const basePrompt = subj.basePrompt || (subj.description || `Photorealistic portrait of the same person, keep identity consistent.`);

  // loop views and call Replicate for each
  for (const view of views) {
    const prompt = `${basePrompt} View: ${view}. Photorealistic, studio lighting, high detail. Keep facial identity and clothing details consistent with the reference.`;
    console.log("Generating view:", view, "prompt:", prompt);

    // configure generation parameters (tweakable)
    const replicateInput = {
      prompt,
      // Many Replicate SDXL ControlNet models accept keys like:
      // image (init image), control_image (control map), prompt_strength (img2img denoising), guidance_scale, num_inference_steps, num_outputs, seed.
      image: baseImageDataUri,
      control_image: controlImageDataUri,
      prompt_strength: job.payload?.prompt_strength ?? 0.6, // 0..1 (0 = preserve exactly, 1 = ignore base)
      guidance_scale: job.payload?.guidance_scale ?? 7.5,
      num_inference_steps: job.payload?.steps ?? 20,
      num_outputs: job.payload?.num_outputs ?? 1,
      seed: job.payload?.seed ?? null
    };

    // call replicate
    try {
      const results = await generateWithReplicate(replicateInput);
      // results expected to be array of data URIs or URLs (depends on model)
      // normalize results to array of image buffers to write to files
      if (!Array.isArray(results) || results.length === 0) {
        subj.warnings = subj.warnings || [];
        subj.warnings.push(`Replicate returned no images for view ${view}`);
        continue;
      }

      for (let i = 0; i < results.length; i++) {
        const out = results[i];
        // out may be a URL (string) or data URI
        let buffer;
        if (typeof out === "string" && out.startsWith("data:image")) {
          // data URI -> buffer
          buffer = Buffer.from(out.split(",")[1], "base64");
        } else if (typeof out === "string" && (out.startsWith("http://") || out.startsWith("https://"))) {
          // download remote URL
          const r = await fetch(out);
          const arr = new Uint8Array(await r.arrayBuffer());
          buffer = Buffer.from(arr);
        } else if (out && out.base64) {
          buffer = Buffer.from(out.base64, "base64");
        } else {
          console.warn("Unknown output format from replicate for view", view, out);
          continue;
        }

        const outName = `rep-${subjectId}-${view}-${Date.now()}-${i}.png`;
        const outPath = path.join(GENERATED_DIR, outName);
        fs.writeFileSync(outPath, buffer);
        subj.assets.push({ type: "preview", view, url: `/generated/${outName}`, generatedAt: new Date().toISOString(), source: source.url });
        console.log("Saved generated preview:", outName);
      }
      // persist subject after each view so progress is visible
      fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));
    } catch (err) {
      console.error("Replicate generation error for view", view, err);
      subj.warnings = subj.warnings || [];
      subj.warnings.push(`Generation failed for view ${view}: ${String(err)}`);
      fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));
    }
  }

  // update status
  subj.status = job.payload?.previewOnly ? "awaiting-approval" : "generated";
  fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));
  console.log("Generate-views finished for", subjectId);
}

/* ---------- Replicate helper functions ---------- */

/**
 * Convert a local image file to a data URI (data:image/png;base64,...)
 */
async function fileToDataUri(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".png" ? "image/png" : "application/octet-stream";
  const buf = fs.readFileSync(filePath);
  const b64 = buf.toString("base64");
  return `data:${mime};base64,${b64}`;
}

/**
 * Call Replicate to generate with the model version in env REPLICATE_MODEL_VERSION
 * - inputObj is a plain object of inputs expected by the model (prompt, image, control_image, steps, etc)
 * Returns: array of outputs from prediction.output (strings)
 *
 * See Replicate docs for details: https://replicate.com/docs
 * Example ControlNet model pages: fermatresearch/sdxl-controlnet-lora (API reference shows allowed fields).
 * :contentReference[oaicite:2]{index=2}
 */
async function generateWithReplicate(inputObj) {
  const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
  const REPLICATE_MODEL_VERSION = process.env.REPLICATE_MODEL_VERSION; // e.g. "3bb13fe1..." (pick from model's Versions)
  if (!REPLICATE_API_TOKEN || !REPLICATE_MODEL_VERSION) throw new Error("REPLICATE_API_TOKEN and REPLICATE_MODEL_VERSION must be set in env");

  // Build request
  const createResp = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${REPLICATE_API_TOKEN}`,
    },
    body: JSON.stringify({
      version: REPLICATE_MODEL_VERSION,
      input: inputObj
    })
  });
  if (!createResp.ok) {
    const txt = await createResp.text();
    throw new Error(`Replicate create prediction failed: ${createResp.status} ${txt}`);
  }
  const createJson = await createResp.json();
  const predictionId = createJson.id;
  console.log("Replicate prediction created:", predictionId);

  // Poll until finished
  const statusUrl = `https://api.replicate.com/v1/predictions/${predictionId}`;
  while (true) {
    await new Promise(r => setTimeout(r, 2500));
    const pollResp = await fetch(statusUrl, {
      headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` }
    });
    if (!pollResp.ok) {
      const t = await pollResp.text();
      throw new Error(`Replicate poll failed: ${pollResp.status} ${t}`);
    }
    const pollJson = await pollResp.json();
    // pollJson.status -> starting|processing|succeeded|failed
    if (pollJson.status === "succeeded") {
      // pollJson.output may be array of urls or data URIs - return it directly
      return pollJson.output;
    }
    if (pollJson.status === "failed") {
      throw new Error(`Replicate failed: ${JSON.stringify(pollJson.error || pollJson)}`);
    }
    // otherwise continue polling
    console.log("Replicate status", pollJson.status);
  }
}

/* ---------- Poll loop ---------- */

async function pollLoop() {
  console.log("Worker started - polling for jobs in data/jobs/");
  while (true) {
    try {
      const jobs = listJobs();
      for (const jfile of jobs) {
        const jobPath = path.join(JOB_DIR, jfile);
        const raw = fs.readFileSync(jobPath, "utf8");
        const job = JSON.parse(raw);
        // skip jobs already running/done
        if (job.status && ["running", "done"].includes(job.status)) continue;

        await processJobFile(jfile);
      }
    } catch (err) {
      console.error("Worker loop error:", err);
    }
    // Poll interval
    await new Promise(res => setTimeout(res, 2500));
  }
}

pollLoop();
