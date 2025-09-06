import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import Replicate from "replicate";
import { v4 as uuidv4 } from "uuid";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UPLOAD_BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || "uploads";
const GENERATED_BUCKET = process.env.SUPABASE_GENERATED_BUCKET || "generated";
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_ env vars");
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  global: { fetch },
});

const ROOT = process.cwd();
const TMP = path.join(ROOT, "tmp");
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

async function listQueuedJob() {
  const { data, error } = await supabaseAdmin
    .from("jobs")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw error;
  return data && data.length ? data[0] : null;
}

async function markJobStatus(jobId, status) {
  await supabaseAdmin.from("jobs").update({ status, finished_at: status === "done" ? new Date().toISOString() : null }).eq("id", jobId);
}

async function downloadStorageToLocalTemp(bucket, objectPath) {
  const { data, error } = await supabaseAdmin.storage.from(bucket).download(objectPath);
  if (error) throw error;

  const fname = `tmp-${uuidv4()}${path.extname(objectPath) || ".png"}`;
  const outPath = path.join(TMP, fname);

  if (data.arrayBuffer) {
    const arr = await data.arrayBuffer();
    fs.writeFileSync(outPath, Buffer.from(arr));
    return outPath;
  }
  // stream fallback
  const chunks = [];
  for await (const chunk of data.stream()) chunks.push(chunk);
  fs.writeFileSync(outPath, Buffer.concat(chunks));
  return outPath;
}

async function uploadBufferToGenerated(buffer, subjectId, idx = 0) {
  const fname = `nb-${subjectId}-${Date.now()}-${idx}.png`;
  const objectPath = `${subjectId}/${fname}`;
  const { error } = await supabaseAdmin.storage.from(GENERATED_BUCKET).upload(objectPath, buffer);
  if (error) throw error;
  const { data } = await supabaseAdmin.storage.from(GENERATED_BUCKET).createSignedUrl(objectPath, 60 * 60);
  return { objectPath, url: data?.signedUrl || null };
}

async function createThumbAndUpload(localPath, subjectId, kind = "face") {
  const thumbBuf = await sharp(localPath).resize(512, 512, { fit: "cover" }).png().toBuffer();
  return uploadBufferToGenerated(thumbBuf, subjectId, kind === "face" ? 0 : 1);
}

/** handle preprocess job */
async function handlePreprocess(job) {
  const subjectId = job.subject_id;
  console.log("Preprocess job for subject:", subjectId);

  // fetch subject
  const { data: subjRows, error: subjErr } = await supabaseAdmin.from("subjects").select("*").eq("id", subjectId).single();
  if (subjErr || !subjRows) throw subjErr || new Error("Subject not found");

  const subj = subjRows;

  const assets = subj.assets || [];
  const warnings = subj.warnings || [];

  // download first faceRef and bodyRef if present (we expect face_refs and body_refs to contain object paths or signed urls)
  if (Array.isArray(subj.face_refs) && subj.face_refs.length) {
    const f = subj.face_refs[0];
    // if f.url is a signed URL we can fetch it, otherwise assume objectPath under uploads bucket (owner/filename)
    try {
      let localPath;
      if (f.url && f.url.startsWith("http")) {
        // fetch and save to tmp
        const r = await fetch(f.url);
        const arr = new Uint8Array(await r.arrayBuffer());
        const p = path.join(TMP, `face-${uuidv4()}.png`);
        fs.writeFileSync(p, Buffer.from(arr));
        localPath = p;
      } else if (f.url && f.url.startsWith("/")) {
        // it's a local public path, try to read from public
        const pub = path.join(process.cwd(), "public", f.url.replace(/^\//, ""));
        if (fs.existsSync(pub)) localPath = pub;
      } else if (f.filename) {
        // assume objectPath like owner/filename -> download from uploads
        const obj = f.filename.includes("/") ? f.filename : `${f.owner || "anon"}/${f.filename}`;
        localPath = await downloadStorageToLocalTemp(UPLOAD_BUCKET, obj);
      }

      if (localPath) {
        const saved = await createThumbAndUpload(localPath, subjectId, "face");
        assets.push({ type: "thumb_face", url: saved.url, objectPath: saved.objectPath, origin: f.url || f.filename });
      } else {
        warnings.push("Unable to locate faceRef for thumb creation.");
      }
    } catch (e) {
      console.warn("Failed face thumb creation", e);
      warnings.push("Face thumb creation failed: " + String(e));
    }
  }

  if (Array.isArray(subj.body_refs) && subj.body_refs.length) {
    const b = subj.body_refs[0];
    try {
      let localPath;
      if (b.url && b.url.startsWith("http")) {
        const r = await fetch(b.url);
        const arr = new Uint8Array(await r.arrayBuffer());
        const p = path.join(TMP, `body-${uuidv4()}.png`);
        fs.writeFileSync(p, Buffer.from(arr));
        localPath = p;
      } else if (b.filename) {
        const obj = b.filename.includes("/") ? b.filename : `${b.owner || "anon"}/${b.filename}`;
        localPath = await downloadStorageToLocalTemp(UPLOAD_BUCKET, obj);
      }
      if (localPath) {
        const saved = await createThumbAndUpload(localPath, subjectId, "body");
        assets.push({ type: "thumb_body", url: saved.url, objectPath: saved.objectPath, origin: b.url || b.filename });
      } else {
        warnings.push("Unable to locate bodyRef for thumb creation.");
      }
    } catch (e) {
      console.warn("Failed body thumb creation", e);
      warnings.push("Body thumb creation failed: " + String(e));
    }
  }

  // update subject row
  const { error: updErr } = await supabaseAdmin.from("subjects").update({
    assets,
    warnings,
    status: "awaiting-approval",
  }).eq("id", subjectId);

  if (updErr) throw updErr;
  console.log("Preprocess completed for", subjectId);
}

/** handle generate-model-sheet job (simple approach): call replicate for face angles */
async function handleGenerateModelSheet(job) {
  const subjectId = job.subject_id;
  console.log("generate-model-sheet job", subjectId);

  const { data: subjRows, error: subjErr } = await supabaseAdmin.from("subjects").select("*").eq("id", subjectId).single();
  if (subjErr || !subjRows) throw subjErr || new Error("subject not found");

  const subj = subjRows;
  const faceRef = (subj.face_refs && subj.face_refs[0]) || null;

  if (!faceRef) {
    // nothing to generate
    await supabaseAdmin.from("subjects").update({ warnings: (subj.warnings || []).concat(["No faceRef for sheet generation"]) }).eq("id", subjectId);
    return;
  }

  // create signed url or data uri for faceRef
  let inputImage;
  if (faceRef.url && faceRef.url.startsWith("http")) inputImage = faceRef.url;
  else if (faceRef.filename) {
    const cand = faceRef.filename.replace(/^\//, "");
    const { data } = await supabaseAdmin.storage.from(UPLOAD_BUCKET).createSignedUrl(cand, 60 * 60);
    inputImage = data?.signedUrl;
  }

  if (!inputImage) {
    console.warn("No usable faceRef url for replicate input");
    await supabaseAdmin.from("subjects").update({ warnings: (subj.warnings || []).concat(["No usable faceRef URL"]) }).eq("id", subjectId);
    return;
  }

  const faceAngles = ["center","up-left","up","up-right","left","3q-left","3q-right","right","down"];
  const outputs = [];
  for (const angle of faceAngles) {
    const prompt = `${subj.base_prompt || subj.description || "Photorealistic portrait"} Close-up portrait, ${angle}, neutral expression, studio lighting. Preserve identity.`;
    try {
      const modelId = process.env.REPLICATE_MODEL_NAME || "google/nano-banana";
      const runInput = { prompt, image_input: [inputImage] };
      const rawOut = await replicate.run(modelId, { input: runInput });
      // rawOut may be array / strings / objects; try to extract first URL
      let extracted = null;
      if (typeof rawOut === "string") extracted = rawOut;
      else if (Array.isArray(rawOut) && rawOut.length) {
        const candidate = rawOut[0];
        if (typeof candidate === "string") extracted = candidate;
        else if (candidate?.url) extracted = (typeof candidate.url === "function" ? await candidate.url() : candidate.url);
      } else if (rawOut?.url) {
        extracted = typeof rawOut.url === "function" ? await rawOut.url() : rawOut.url;
      }

      if (!extracted) {
        console.warn("No extractable output for angle", angle, rawOut);
        subj.warnings = (subj.warnings || []).concat([`No output for angle ${angle}`]);
        continue;
      }

      // download image & upload to generated bucket
      const r = await fetch(extracted);
      const arr = new Uint8Array(await r.arrayBuffer());
      const buff = Buffer.from(arr);
      const uploaded = await uploadBufferToGenerated(buff, subjectId, Math.floor(Math.random() * 1000));
      outputs.push({ angle, url: uploaded.url, objectPath: uploaded.objectPath });
      console.log("Saved angle", angle, uploaded.url);
    } catch (e) {
      console.error("Failed generating angle", angle, e);
      subj.warnings = (subj.warnings || []).concat([`Generation error for ${angle}: ${String(e)}`]);
    }
  }

  const newAssets = (subj.assets || []).concat(outputs.map(o => ({ type: "sheet_face", angle: o.angle, url: o.url, objectPath: o.objectPath })));
  await supabaseAdmin.from("subjects").update({ assets: newAssets, status: "sheet_generated", warnings: subj.warnings || [] }).eq("id", subjectId);
  console.log("Model sheet complete for", subjectId);
}

/** main poll loop */
async function pollLoop() {
  console.log("Worker started - polling jobs table...");
  while (true) {
    try {
      const job = await listQueuedJob();
      if (job) {
        console.log("Picked job:", job.id, job.type);
        await markJobStatus(job.id, "running");
        try {
          if (job.type === "preprocess") {
            await handlePreprocess(job);
          } else if (job.type === "generate-model-sheet") {
            await handleGenerateModelSheet(job);
          } else {
            console.warn("Unknown job type:", job.type);
          }
          await markJobStatus(job.id, "done");
        } catch (e) {
          console.error("Job processing failed", e);
          await supabaseAdmin.from("jobs").update({ status: "failed", finished_at: new Date().toISOString() }).eq("id", job.id);
        }
      }
    } catch (err) {
      console.error("Worker error", err);
    }
    await new Promise(r => setTimeout(r, 2500));
  }
}

pollLoop().catch((e) => {
  console.error("Worker crashed", e);
  process.exit(1);
});
