// src/app/api/subject/[id]/status/route.js
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const SUBJECT_DIR = path.join(process.cwd(), "data", "subjects");

export async function GET(req, context) {
  try {
    // Resolve params safely (works whether params is sync or async)
    const params = context?.params;
    const resolvedParams = (params && typeof params.then === "function") ? await params : params;
    const { id } = resolvedParams || {};

    if (!id) {
      return NextResponse.json({ error: "Missing subject id" }, { status: 400 });
    }

    const file = path.join(SUBJECT_DIR, `${id}.json`);
    if (!fs.existsSync(file)) {
      return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    }
    const raw = fs.readFileSync(file, "utf8");
    const subject = JSON.parse(raw);
    return NextResponse.json({ subject });
  } catch (err) {
    console.error("GET /api/subject/:id/status error:", err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
