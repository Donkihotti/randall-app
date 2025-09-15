// worker/photoshoot-worker.js
// ESM-friendly worker for processing photoshoot jobs
// Run: npx dotenv -e .env.local -- node worker/photoshoot-worker.js

import { createClient } from "@supabase/supabase-js";
import path from "path";
import { randomUUID } from "crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, { auth: { persistSession: false } });

/** sleep helper */
function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Fetch with retries (uses global fetch). Returns Response or throws last error.
 */
async function fetchWithRetries(url, opts = {}, attempts = 3, backoffMs = 500) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      // implement abort timeout
      let controller = null;
      let timeoutId = null;
      if (typeof AbortController !== "undefined") {
        controller = new AbortController();
        if (opts.timeout) timeoutId = setTimeout(() => controller.abort(), opts.timeout);
      }
      const res = await fetch(url, { ...opts, signal: controller?.signal });
      if (timeoutId) clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`fetch failed status=${res.status}`);
      return res;
    } catch (err) {
      lastErr = err;
      console.warn(`[worker] fetch attempt ${i + 1} failed for ${url}:`, err && err.message ? err.message : err);
      // small backoff
      await sleep(backoffMs * (i + 1));
    }
  }
  throw lastErr;
}

/**
 * Create a simple SVG buffer fallback (so worker can proceed offline).
 * Returns { buffer, mime, filename }.
 */
function createSvgFallback(label = "photoshoot", width = 1024, height = 1024) {
  const fontSize = Math.max(18, Math.floor(width / 16));
  const svg = `<?xml version="1.0" encoding="utf-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#e6e6e6"/>
    <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
      font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" fill="#444">${escapeXml(label)}</text>
  </svg>`;
  return { buffer: Buffer.from(svg), mime: "image/svg+xml", filename: `${slugify(label)}.svg` };
}

/** tiny helper to slugify filenames */
function slugify(s = "") {
  return s.toString().toLowerCase().replace(/[^a-z0-9\-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 128) || "file";
}

/** tiny xml escape */
function escapeXml(str = "") {
  return String(str).replace(/[&<>'"]/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "'": return "&apos;";
      case '"': return "&quot;";
      default: return c;
    }
  });
}

/**
 * generateImagesPlaceholder(job, photoshoot)
 * - tries to fetch placeholder images from remote; if network/DNS fails, uses SVG fallback
 * - returns array of { buffer, filename, mime }
 */
async function generateImagesPlaceholder(job, photoshoot) {
  const shots = (job && job.shots) ? Number(job.shots) : 3;
  const images = [];

  for (let i = 0; i < shots; i++) {
    const label = `${photoshoot?.name || "photoshoot"}-${i + 1}`;
    const remoteUrl = `https://via.placeholder.com/1024?text=${encodeURIComponent(label)}`;

    try {
      console.log("[worker] fetching placeholder image", remoteUrl);
      const resp = await fetchWithRetries(remoteUrl, { timeout: 30_000 }, 3, 400);
      const arrayBuf = await resp.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      images.push({ buffer, filename: `shot-${i + 1}.png`, mime: resp.headers.get("content-type") || "image/png" });
    } catch (err) {
      // don't abort job on network/DNS failure — fallback to an SVG image and continue
      console.warn("[worker] placeholder fetch failed (network/DNS). Using SVG fallback for", label, "error:", err && err.message ? err.message : err);
      const fallback = createSvgFallback(label, 1024, 1024);
      images.push({ buffer: fallback.buffer, filename: fallback.filename, mime: fallback.mime });
    }
  }

  return images;
}

/**
 * Upload buffer to storage and create assets row in DB.
 * Signature: uploadAssetAndCreateRow(photoshootId, ownerId, fileObj)
 * Returns inserted asset row.
 */
async function uploadAssetAndCreateRow(photoshootId, ownerId, fileObj) {
  const bucket = process.env.PHOTOSHOOT_BUCKET || "generated";
  const objectPath = `${photoshootId}/${Date.now()}-${slugify(fileObj.filename)}`;
  console.log("[worker] uploading to storage", { bucket, objectPath });

  const uploadRes = await supabaseAdmin.storage.from(bucket).upload(objectPath, fileObj.buffer, {
    contentType: fileObj.mime,
    upsert: false,
  });

  if (uploadRes.error) {
    console.error("[worker] upload error", uploadRes.error);
    throw uploadRes.error;
  }

  const assetId = randomUUID();
  const assetRow = {
    id: assetId,
    owner_id: ownerId || null,
    subject_id: null,
    type: "photo",
    object_path: objectPath,
    bucket,
    filename: fileObj.filename,
    url: null,
    meta: { generated_by: "photoshoot-worker" },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data: inserted, error: assetErr } = await supabaseAdmin
    .from("assets")
    .insert([assetRow])
    .select()
    .limit(1)
    .maybeSingle();

  if (assetErr) {
    console.error("[worker] insert asset row error", assetErr);
    // try cleanup uploaded file
    try {
      await supabaseAdmin.storage.from(bucket).remove([objectPath]);
    } catch (e) {
      console.warn("[worker] cleanup failed", e);
    }
    throw assetErr;
  }

  return inserted;
}

/** create photoshoot_assets link */
async function createPhotoshootAssetRelation(photoshootId, assetRow, position = 0, role = "result") {
  const row = {
    photoshoot_id: photoshootId,
    asset_id: assetRow.id,
    role,
    position,
    created_at: new Date().toISOString(),
  };
  const { data, error } = await supabaseAdmin
    .from("photoshoot_assets")
    .insert([row])
    .select()
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[worker] failed to insert photoshoot_assets", error);
    throw error;
  }
  return data;
}

/** mark job status */
async function markJobStatus(jobId, updates = {}) {
  try {
    const { data, error } = await supabaseAdmin
      .from("photoshoot_jobs")
      .update(updates)
      .eq("id", jobId)
      .select()
      .limit(1)
      .maybeSingle();
    if (error) console.error("[worker] failed to update job", error);
    return { data, error };
  } catch (err) {
    console.error("[worker] markJobStatus unexpected", err);
    return { data: null, error: err };
  }
}

/** best-effort mark job failed */
async function markJobFailed(jobId, err) {
  const message = (err && err.message) ? String(err.message) : String(err);
  console.error("[worker] markJobFailed:", jobId, message);
  await markJobStatus(jobId, {
    status: "failed",
    error: message,
    finished_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

/**
 * Main job processing
 * - picks queued job, marks running, generates images (remote or fallback),
 * - uploads + inserts asset rows, creates relations, marks job succeeded.
 */
export async function processOneJob() {
  try {
    const { data: job } = await supabaseAdmin
      .from("photoshoot_jobs")
      .select("*")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!job) {
      return false;
    }

    console.log("[worker] picked job", job.id);
    await markJobStatus(job.id, { status: "running", started_at: new Date().toISOString(), updated_at: new Date().toISOString() });

    const { data: photoshoot } = await supabaseAdmin
      .from("photoshoots")
      .select("*")
      .eq("id", job.photoshoot_id)
      .limit(1)
      .maybeSingle();

    if (!photoshoot) {
      console.error("[worker] photoshoot not found for job", job.photoshoot_id);
      await markJobFailed(job.id, new Error("photoshoot_not_found"));
      return true;
    }

    let images;
    try {
      images = await generateImagesPlaceholder(job, photoshoot);
    } catch (err) {
      console.error("[worker] image generation failed", err);
      await markJobFailed(job.id, err);
      return true;
    }

    console.log("[worker] generated images count:", images.length);

    for (let i = 0; i < images.length; i++) {
      const fileObj = images[i];
      try {
        const assetRow = await uploadAssetAndCreateRow(photoshoot.id, photoshoot.owner_id, fileObj);
        await createPhotoshootAssetRelation(photoshoot.id, assetRow, i, "result");
        console.log("[worker] uploaded and linked asset", assetRow.id);
        if (!photoshoot.base_asset_id && i === 0) {
            try {
              const { data: updated, error: updErr } = await supabaseAdmin
                .from("photoshoots")
                .update({ base_asset_id: assetRow.id, updated_at: new Date().toISOString() })
                .eq("id", photoshoot.id)
                .select()
                .limit(1)
                .maybeSingle();
      
              if (updErr) {
                console.warn("[worker] failed to set base_asset_id", updErr);
              } else {
                // also update local photoshoot variable so subsequent logic sees it
                photoshoot.base_asset_id = assetRow.id;
                console.log("[worker] set photoshoot.base_asset_id =", assetRow.id);
              }
            } catch (e) {
              console.warn("[worker] exception while setting base_asset_id", e);
            }
          }
      
        } catch (err) {
          console.error("[worker] failed to upload/link image", err);
          await markJobFailed(job.id, err);
          return true;
        }
      }

    await markJobStatus(job.id, { status: "succeeded", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    await supabaseAdmin.from("photoshoots").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", photoshoot.id);

    console.log("[worker] job completed successfully", job.id);
    return true;
  } catch (err) {
    console.error("[worker] processOneJob unexpected error", err);
    return true;
  }
}

/** run loop */
async function runLoop() {
  console.log("[worker] starting run loop (poll every 3s)");
  while (true) {
    try {
      const didWork = await processOneJob();
      if (!didWork) await sleep(3000);
    } catch (e) {
      console.error("[worker] loop error", e);
      await sleep(5000);
    }
  }
}

const runAsScript = !!(process.argv && process.argv[1] && process.argv[1].endsWith(path.basename(import.meta.url)));
if (runAsScript) runLoop();
