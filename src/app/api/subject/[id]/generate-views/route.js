// src/app/api/subject/[id]/generate-views/route.js
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const JOB_DIR = path.join(process.cwd(), "data", "jobs");
const SUBJECT_DIR = path.join(process.cwd(), "data", "subjects");

if (!fs.existsSync(JOB_DIR)) fs.mkdirSync(JOB_DIR, { recursive: true });

export async function POST(req, context) {
  try {
    // resolve params safely
    const params = context?.params;
    const resolvedParams = (params && typeof params.then === "function") ? await params : params;
    const { id } = resolvedParams || {};

    if (!id) return NextResponse.json({ error: "Missing subject id" }, { status: 400 });

    const body = await req.json(); // { views: [...], previewOnly: true/false }
    const subjFile = path.join(SUBJECT_DIR, `${id}.json`);
    if (!fs.existsSync(subjFile)) return NextResponse.json({ error: "Subject not found" }, { status: 404 });

    const jobId = `job_${uuidv4()}`;
    const job = {
      id: jobId,
      type: "generate-views",
      subjectId: id,
      createdAt: new Date().toISOString(),
      status: "queued",
      payload: {
        views: Array.isArray(body.views) ? body.views : ["front", "left", "right"],
        previewOnly: !!body.previewOnly
      }
    };
    fs.writeFileSync(path.join(JOB_DIR, `${jobId}.json`), JSON.stringify(job, null, 2));

    // append job ref to subject
    const subj = JSON.parse(fs.readFileSync(subjFile, "utf8"));
    subj.jobs = subj.jobs || [];
    subj.jobs.push({ jobId, type: job.type, enqueuedAt: job.createdAt });
    subj.status = "queued_generation";
    fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));

    return NextResponse.json({ ok: true, jobId });
  } catch (err) {
    console.error("POST /api/subject/:id/generate-views error:", err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
