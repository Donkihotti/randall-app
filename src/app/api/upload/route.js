// src/app/api/upload/route.js
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function sanitizeFilename(name) {
  // preserve extension
  const ext = path.extname(name) || ".png";
  const base = path.basename(name, ext)
    .replace(/\s+/g, "-")            // spaces -> dash
    .replace(/[^a-zA-Z0-9\-_]/g, "") // remove other special chars
    .toLowerCase()
    .slice(0, 120);
  return `${base}-${uuidv4()}${ext}`;
}

export async function POST(req) {
  try {
    const body = await req.json(); // expect { filename, b64 } where b64 is base64 without data: prefix
    const { filename = "upload.png", b64 } = body;
    if (!b64) return NextResponse.json({ error: "Missing b64" }, { status: 400 });

    const sanitized = sanitizeFilename(filename);
    const outPath = path.join(UPLOAD_DIR, sanitized);
    const buffer = Buffer.from(b64, "base64");
    fs.writeFileSync(outPath, buffer);

    const url = `/uploads/${sanitized}`;
    return NextResponse.json({ ok: true, url, filename: sanitized });
  } catch (err) {
    console.error("upload error", err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
