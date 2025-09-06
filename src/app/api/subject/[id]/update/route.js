// src/app/api/subject/[id]/update/route.js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

export async function POST(req, context) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.split(" ")[1] : null;
    if (!token) return NextResponse.json({ error: "Missing access token" }, { status: 401 });

    const { data: userData, error: uErr } = await supabase.auth.getUser(token);
    if (uErr || !userData?.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const userId = userData.user.id;

    const params = context?.params;
    const resolved = params && typeof params.then === "function" ? await params : params;
    const id = resolved?.id;
    if (!id) return NextResponse.json({ error: "Missing subject id" }, { status: 400 });

    const body = await req.json(); // partial patch: { status?, addAssets?, pushWarnings?, mergeMetadata? }
    const patch = {};

    if (body.status) patch.status = body.status;
    if (body.metadata) patch.metadata = body.metadata;
    if (body.addAssets) {
      // fetch existing, append then update (transactional approach simplified)
      const { data: existing, error: exErr } = await supabase.from("subjects").select("assets").eq("id", id).single();
      if (exErr) return NextResponse.json({ error: "Subject fetch failed" }, { status: 500 });
      const assets = Array.isArray(existing.assets) ? existing.assets : [];
      patch.assets = [...assets, ...body.addAssets];
    }
    if (body.pushWarnings) {
      const { data: existing, error: exErr } = await supabase.from("subjects").select("warnings").eq("id", id).single();
      if (exErr) return NextResponse.json({ error: "Subject fetch failed" }, { status: 500 });
      const warnings = Array.isArray(existing.warnings) ? existing.warnings : [];
      patch.warnings = [...warnings, ...body.pushWarnings];
    }

    patch.updated_at = new Date().toISOString();

    // Ensure owner matches (read then update) — we check owner to prevent tampering
    const { data: subjectRow, error: sErr } = await supabase.from("subjects").select("owner_id").eq("id", id).single();
    if (sErr) return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    if (subjectRow.owner_id !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data, error } = await supabase.from("subjects").update(patch).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: "Update failed" }, { status: 500 });

    return NextResponse.json({ ok: true, subject: data });
  } catch (err) {
    console.error("POST /api/subject/[id]/update error:", err);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
