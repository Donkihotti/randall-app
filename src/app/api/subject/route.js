// src/app/api/subject/route.js
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const DATA_DIR = path.join(process.cwd(), "data");
const SUBJECT_DIR = path.join(DATA_DIR, "subjects");
const JOB_DIR = path.join(DATA_DIR, "jobs");

for (const d of [UPLOAD_DIR, DATA_DIR, SUBJECT_DIR, JOB_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function saveB64ToFile(b64, filename) {
  const buf = Buffer.from(b64, "base64");
  const outPath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(outPath, buf);
  return `/uploads/${filename}`;
}

export async function POST(req) {
  try {
    const body = await req.json();

    // Basic validation
    if (!body || !body.name) {
      return NextResponse.json({ error: "Missing required field: name" }, { status: 400 });
    }
    if ((!body.faceRefs || body.faceRefs.length === 0) && (!body.bodyRefs || body.bodyRefs.length === 0)) {
      return NextResponse.json({ error: "Please provide at least one faceRef or bodyRef" }, { status: 400 });
    }

    const id = `sub_${uuidv4()}`;
    const createdAt = new Date().toISOString();
    const subjectFolder = path.join(SUBJECT_DIR, id);
    if (!fs.existsSync(subjectFolder)) fs.mkdirSync(subjectFolder, { recursive: true });

    const storedFaceRefs = [];
    const storedBodyRefs = [];

    // faceRefs and bodyRefs can be passed as { filename, b64 } items OR { url } items.
    if (Array.isArray(body.faceRefs)) {
      for (const f of body.faceRefs) {
        if (f?.b64 && f?.filename) {
          const safeName = `${Date.now()}-${id}-face-${path.basename(f.filename)}`;
          const publicUrl = saveB64ToFile(f.b64, safeName);
          storedFaceRefs.push({ filename: safeName, url: publicUrl });
        } else if (f?.url) {
          storedFaceRefs.push({ filename: path.basename(f.url), url: f.url });
        }
      }
    }

    if (Array.isArray(body.bodyRefs)) {
      for (const b of body.bodyRefs) {
        if (b?.b64 && b?.filename) {
          const safeName = `${Date.now()}-${id}-body-${path.basename(b.filename)}`;
          const publicUrl = saveB64ToFile(b.b64, safeName);
          storedBodyRefs.push({ filename: safeName, url: publicUrl });
        } else if (b?.url) {
          storedBodyRefs.push({ filename: path.basename(b.url), url: b.url });
        }
      }
    }

    // subject record
    const subject = {
      id,
      name: body.name,
      description: body.description || "",
      brand: body.brand || null,
      consentConfirmed: !!body.consentConfirmed,
      basePrompt: body.basePrompt || "",
      createdAt,
      status: "queued", // queued -> preprocessing -> awaiting-approval -> ready
      faceRefs: storedFaceRefs,
      bodyRefs: storedBodyRefs,
      assets: [], // populated by worker (thumbnails, pose maps, previews)
      warnings: [],
      metadata: body.metadata || {},
      jobs: []
    };

    // persist subject metadata
    fs.writeFileSync(path.join(SUBJECT_DIR, `${id}.json`), JSON.stringify(subject, null, 2));

    // enqueue a preprocess job
    const jobId = `job_${uuidv4()}`;
    const job = {
      id: jobId,
      type: "preprocess",
      subjectId: id,
      createdAt: new Date().toISOString(),
      status: "queued",
      payload: {}
    };
    fs.writeFileSync(path.join(JOB_DIR, `${jobId}.json`), JSON.stringify(job, null, 2));

    // update subject with job ref
    subject.jobs.push({ jobId, type: job.type, enqueuedAt: job.createdAt });
    fs.writeFileSync(path.join(SUBJECT_DIR, `${id}.json`), JSON.stringify(subject, null, 2));

    return NextResponse.json({ subjectId: id, jobId, status: subject.status });
  } catch (err) {
    console.error("POST /api/subject error:", err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
