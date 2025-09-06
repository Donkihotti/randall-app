// src/app/api/subject/create/route.js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE env vars");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function sanitizeString(s = "") {
  return String(s || "").trim();
}

export async function POST(req) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.split(" ")[1] : null;
    if (!token) return NextResponse.json({ error: "Missing access token" }, { status: 401 });

    // validate token and get user
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Invalid access token" }, { status: 401 });
    }
    const user = userData.user;
    const userId = user.id;

    const body = await req.json();
    if (!body?.name || sanitizeString(body.name) === "") {
      return NextResponse.json({ error: "Missing required field: name" }, { status: 400 });
    }

    const isDraft = !!body.draft;

    // if not draft, require refs
    if (!isDraft) {
      const hasRefs = (Array.isArray(body.faceRefs) && body.faceRefs.length > 0) ||
                      (Array.isArray(body.bodyRefs) && body.bodyRefs.length > 0);
      if (!hasRefs) {
        return NextResponse.json({ error: "Please provide at least one faceRef or bodyRef" }, { status: 400 });
      }
    }

    // build row
    const row = {
      owner_id: userId,
      name: sanitizeString(body.name),
      description: sanitizeString(body.description || ""),
      consent_confirmed: !!body.consentConfirmed,
      base_prompt: body.basePrompt || "",
      status: isDraft ? "awaiting-generation" : "queued",
      face_refs: body.faceRefs || [],
      body_refs: body.bodyRefs || [],
      assets: [],
      warnings: [],
      metadata: body.metadata || {},
      jobs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase.from("subjects").insert(row).select().single();
    if (error) {
      console.error("Insert subject error:", error);
      return NextResponse.json({ error: "Failed to create subject" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, subject: data });
  } catch (err) {
    console.error("POST /api/subject/create error:", err);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
