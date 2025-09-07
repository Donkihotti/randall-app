// src/app/api/subject/[id]/assets/route.js
import { NextResponse } from "next/server";
import { createServerSupabase } from "../../../../../../utils/supabase/server";
import { supabaseAdmin } from "../../../../../../lib/supabaseServer";

const SIGNED_URL_TTL = Number(process.env.SIGNED_URL_TTL_SECONDS || 1200);
const GENERATED_BUCKET = process.env.SUPABASE_GENERATED_BUCKET || "generated";

/** create signed url for object path (using service role) */
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
    const { id } = params && (typeof params.then === "function" ? await params : params) || {};
    if (!id) return NextResponse.json({ error: "Missing subject id" }, { status: 400 });

    // validate user
    const supabase = await createServerSupabase();
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // check subject exists + ownership using service role
    const { data: subjRow, error: subjErr } = await supabaseAdmin.from("subjects").select("id, owner_id").eq("id", id).single();
    if (subjErr || !subjRow) return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    if (String(subjRow.owner_id) !== String(user.id)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // fetch assets rows for subject (service role)
    const { data: assetsRows, error: assetsErr } = await supabaseAdmin
      .from("assets")
      .select("*")
      .eq("subject_id", id)
      .order("created_at", { ascending: false });

    if (assetsErr) {
      console.warn("GET /assets fetch error:", assetsErr);
      return NextResponse.json({ error: "Failed to fetch assets" }, { status: 500 });
    }

    // enrich with signed urls
    const enriched = await Promise.all((assetsRows || []).map(async (a) => {
      const bucket = a.bucket || GENERATED_BUCKET;
      const objectPath = a.object_path || a.objectPath || a.objectpath || null;
      let signed = a.url || null;
      if (!signed && objectPath) {
        signed = await makeSignedUrl(bucket, objectPath);
      }
      return { ...a, signedUrl: signed || null };
    }));

    return NextResponse.json({ assets: enriched });
  } catch (err) {
    console.error("GET /api/subject/:id/assets error:", err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
