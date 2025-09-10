// src/app/api/subject/[id]/assets/route.js
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  // don't throw here — return error responses at runtime
  console.warn("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment for /api/subject/[id]/assets");
}

const supabaseAdmin = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export async function GET(request, { params }) {
  try {
    const { id: subjectId } = await params;
    if (!subjectId) {
      return NextResponse.json({ ok: false, error: "Missing subject id" }, { status: 400 });
    }

    const url = new URL(request.url);
    const group = url.searchParams.get("group"); // e.g. 'sheet'

    // 1) fetch assets for subject (most recent first)
    const { data: assetsData, error: assetsErr } = await supabaseAdmin
      .from("assets")
      .select("*")
      .eq("subject_id", subjectId)
      .order("created_at", { ascending: false });

    if (assetsErr) {
      console.error("/api/subject/[id]/assets - supabase error:", assetsErr);
      return NextResponse.json({ ok: false, error: assetsErr.message || String(assetsErr) }, { status: 500 });
    }

    let assets = Array.isArray(assetsData) ? assetsData : [];

    // 2) Apply group filter (lightweight server-side filtering)
    if (group) {
      const g = String(group).toLowerCase();
      if (g === "sheet") {
        // include explicit sheet types OR assets with meta.group === 'sheet'
        assets = assets.filter(a =>
          (a.type && ["sheet_face", "sheet_body"].includes(a.type)) ||
          (a.meta && typeof a.meta === "object" && String(a.meta.group || "").toLowerCase() === "sheet")
        );
      } else {
        // general fallback: filter assets where meta.group === group
        assets = assets.filter(a => a.meta && typeof a.meta === "object" && String(a.meta.group || "").toLowerCase() === g);
      }
    }

    // 3) Generate signed urls where possible (best-effort)
    const signedAssets = await Promise.all(assets.map(async (a) => {
      const copy = { ...a };
      try {
        const bucket = a.bucket || process.env.SUPABASE_GENERATED_BUCKET || "generated";
        const objectPath = a.object_path || a.objectPath || a.object || null;
        if (bucket && objectPath) {
          const { data: urlData, error: urlErr } = await supabaseAdmin.storage
            .from(bucket)
            .createSignedUrl(objectPath, 60 * 60); // 1 hour
          if (!urlErr && urlData) {
            copy.signedUrl = (urlData.signedUrl || urlData.signedURL) || null;
          }
        }
      } catch (e) {
        // swallow individual asset errors, but keep the row
        console.warn("/api/subject/[id]/assets - createSignedUrl failed for asset", a.id, e);
      }
      return copy;
    }));

    // 4) Optionally include subject row for convenience (helps client reconciliation)
    let subjectRow = null;
    try {
      const { data: s, error: sErr } = await supabaseAdmin.from("subjects").select("*").eq("id", subjectId).single();
      if (!sErr && s) subjectRow = s;
    } catch (e) {
      // non-fatal
    }

    return NextResponse.json({ ok: true, assets: signedAssets, subject: subjectRow }, { status: 200 });
  } catch (e) {
    console.error("/api/subject/[id]/assets - unexpected error", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
