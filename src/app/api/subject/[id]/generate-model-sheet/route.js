import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const JOB_DIR = path.join(process.cwd(), "data", "jobs");
const SUBJECT_DIR = path.join(process.cwd(), "data", "subjects");
if (!fs.existsSync(JOB_DIR)) fs.mkdirSync(JOB_DIR, { recursive: true });

export async function POST(req, context) {
  try {
    const params = context?.params;
    const resolvedParams = (params && typeof params.then === "function") ? await params : params;
    const { id } = resolvedParams || {};
    if (!id) return NextResponse.json({ error: "Missing subject id" }, { status: 400 });

    const body = await req.json(); // optional: { previewOnly, faceAngles, bodyAngles, settings }
    const jobId = `job_${uuidv4()}`;
    const job = {
      id: jobId,
      type: "generate-model-sheet",
      subjectId: id,
      createdAt: new Date().toISOString(),
      status: "queued",
      payload: {
        previewOnly: !!body.previewOnly,
        faceAngles: body.faceAngles || null, // optional custom angles
        bodyAngles: body.bodyAngles || null, // optional custom angles
        settings: body.settings || {}
      }
    };
    fs.writeFileSync(path.join(JOB_DIR, `${jobId}.json`), JSON.stringify(job, null, 2));

    // append job ref to subject
    const subjFile = path.join(SUBJECT_DIR, `${id}.json`);
    if (fs.existsSync(subjFile)) {
      const subj = JSON.parse(fs.readFileSync(subjFile, "utf8"));
      subj.jobs = subj.jobs || [];
      subj.jobs.push({ jobId, type: job.type, enqueuedAt: job.createdAt });
      subj.status = "queued_generation_sheet";
      fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));
    }

    return NextResponse.json({ ok: true, jobId });
  } catch (err) {
    console.error("POST generate-model-sheet error:", err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
