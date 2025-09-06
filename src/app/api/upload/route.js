// src/app/api/upload/route.js
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseServer";

export async function POST(req) {
  try {
    const body = await req.json();
    const { b64, filename, ownerId = "anon", bucket = "uploads" } = body || {};

    if (!b64 || !filename) {
      return NextResponse.json({ error: "Missing b64 or filename" }, { status: 400 });
    }

    // create unique path: ownerId/ts-filename
    const safeName = `${Date.now()}-${filename.replace(/\s+/g, "_")}`;
    const objectPath = `${ownerId}/${safeName}`;

    const buffer = Buffer.from(b64, "base64");

    const { error: uploadErr } = await supabaseAdmin.storage.from(bucket).upload(objectPath, buffer, {
      contentType: "image/png",
      upsert: false,
    });

    if (uploadErr) {
      console.error("Supabase upload error:", uploadErr);
      return NextResponse.json({ error: uploadErr.message || String(uploadErr) }, { status: 500 });
    }

    // create signed url (1 hour)
    const { data: urlData, error: urlErr } = await supabaseAdmin.storage.from(bucket).createSignedUrl(objectPath, 60 * 60);
    if (urlErr) {
      console.warn("Signed URL creation failed:", urlErr);
    }

    const signedUrl = urlData?.signedUrl || null;

    return NextResponse.json({ ok: true, objectPath, signedUrl });
  } catch (err) {
    console.error("upload route error:", err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
