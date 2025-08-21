import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export async function POST(request) {
  try {
    const body = await request.json(); // { filename, b64 }
    if (!body || !body.filename || !body.b64) {
      return NextResponse.json({ error: "Missing filename or b64 in body" }, { status: 400 });
    }
    const buffer = Buffer.from(body.b64, "base64");
    const safeName = `${Date.now()}-${path.basename(body.filename)}`;
    const outPath = path.join(UPLOAD_DIR, safeName);
    fs.writeFileSync(outPath, buffer);
    const publicUrl = `/uploads/${safeName}`;
    return NextResponse.json({ url: publicUrl }, { status: 200 });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "Upload failed", details: err?.message || String(err) }, { status: 500 });
  }
}
