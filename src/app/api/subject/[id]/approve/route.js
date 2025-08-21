
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const SUBJECT_DIR = path.join(process.cwd(), "data", "subjects");

export async function POST(req, context) {
  try {
    const params = context?.params;
    const resolvedParams = (params && typeof params.then === "function") ? await params : params;
    const { id } = resolvedParams || {};

    if (!id) return NextResponse.json({ error: "Missing subject id" }, { status: 400 });

    const subjFile = path.join(SUBJECT_DIR, `${id}.json`);
    if (!fs.existsSync(subjFile)) return NextResponse.json({ error: "Subject not found" }, { status: 404 });

    const subj = JSON.parse(fs.readFileSync(subjFile, "utf8"));
    subj.status = "ready";
    subj.approvedAt = new Date().toISOString();
    fs.writeFileSync(subjFile, JSON.stringify(subj, null, 2));
    return NextResponse.json({ ok: true, subject: subj });
  } catch (err) {
    console.error("POST /api/subject/:id/approve error:", err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
