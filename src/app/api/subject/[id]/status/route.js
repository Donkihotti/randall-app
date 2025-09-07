// src/app/api/subject/[id]/status/route.js
import { NextResponse } from "next/server";
import { createServerSupabase } from "../../../../../../utils/supabase/server"; // request-bound
import { supabaseAdmin } from "../../../../../../lib/supabaseServer";

const SIGNED_URL_TTL = Number(process.env.SIGNED_URL_TTL_SECONDS || 1200);
const UPLOAD_BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || "uploads";
const GENERATED_BUCKET = process.env.SUPABASE_GENERATED_BUCKET || "generated";

async function makeSignedUrl(bucket, objectPath, ttl = SIGNED_URL_TTL) {
  if (!bucket || !objectPath) return null;
  try {
    const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(objectPath, ttl);
    if (error) {
      console.warn("createSignedUrl error", { bucket, objectPath, error });
      return null;
    }
    return data?.signedUrl || null;
  } catch (e) {
    console.warn("createSignedUrl threw", e);
    return null;
  }
}

export async function GET(req, { params }) {
  try {
    const { id } = (params && (typeof params.then === "function" ? await params : params)) || {};
    if (!id) return NextResponse.json({ error: "Missing subject id" }, { status: 400 });

    // validate user via request-bound supabase
    const supabase = await createServerSupabase();
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // fetch subject (service role to get full row)
    const { data: subjRow, error: subjErr } = await supabaseAdmin.from("subjects").select("*").eq("id", id).single();
    if (subjErr || !subjRow) {
      return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    }
    if (String(subjRow.owner_id) !== String(user.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // fetch assets rows for subject (service role)
    const { data: assetsRows, error: assetsErr } = await supabaseAdmin
      .from("assets")
      .select("*")
      .eq("subject_id", id)
      .order("created_at", { ascending: false });

    if (assetsErr) {
      console.warn("Failed to fetch assets rows:", assetsErr);
    }

    // enrich with signed urls
    const enriched = await Promise.all((assetsRows || []).map(async (a) => {
      const bucket = a.bucket || GENERATED_BUCKET;
      // prefer the canonical column name object_path
      const objectPath = a.object_path || a.objectPath || a.object;
      let signed = a.url || null;
      if (!signed && objectPath) {
        signed = await makeSignedUrl(bucket, objectPath);
      }
      return { ...a, signedUrl: signed || null };
    }));

    const subject = { ...subjRow, assets: enriched };
    return NextResponse.json({ subject });
  } catch (err) {
    console.error("GET /api/subject/:id/status error:", err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
