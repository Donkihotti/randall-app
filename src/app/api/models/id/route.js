// src/app/api/models/[id]/route.js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

export async function GET(request, { params }) {
  try {
    const modelId = await params?.id;
    if (!modelId) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

    // authenticate user (adapt as above)
    const authHeader = request.headers.get("authorization") || "";
    const bearer = authHeader.replace("Bearer ", "").trim();
    let userId = null;
    if (bearer) {
      const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(bearer);
      if (!userErr && userData?.user?.id) userId = userData.user.id;
    }
    if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    // fetch saved collection
    const { data: collection, error: collErr } = await supabaseAdmin
      .from("saved_collections")
      .select("id, owner_id, subject_id, asset_ids, name, created_at")
      .eq("id", modelId)
      .limit(1)
      .maybeSingle();

    if (collErr || !collection) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (collection.owner_id !== userId) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    // asset_ids may be stored as json string; normalize
    let assetIds = collection.asset_ids;
    if (typeof assetIds === "string") {
      try { assetIds = JSON.parse(assetIds); } catch (e) { assetIds = []; }
    }
    if (!Array.isArray(assetIds) || assetIds.length === 0) {
      return NextResponse.json({ ok: true, assets: [] });
    }

    // fetch asset rows (to get bucket/object_path)
    const { data: assetsRows, error: assetsErr } = await supabaseAdmin
      .from("assets")
      .select("id, bucket, object_path, filename, meta")
      .in("id", assetIds);

    if (assetsErr) {
      console.warn("assets fetch err", assetsErr);
      return NextResponse.json({ ok: false, error: "Failed to fetch assets" }, { status: 500 });
    }

    // build signed urls server-side (short expiry)
    const signedExpirySec = 60 * 60; // 1 hour
    const signedAssets = await Promise.all((assetIds || []).map(async (aid) => {
      const a = (assetsRows || []).find(r => r.id === aid);
      if (!a) return null;
      try {
        // if we have bucket/object_path; create signed url
        if (a.bucket && a.object_path) {
          const { data: signed, error: signErr } = await supabaseAdmin
            .storage
            .from(a.bucket)
            .createSignedUrl(a.object_path, signedExpirySec);
          if (!signErr && signed?.signedURL) {
            return { id: a.id, url: signed.signedURL, meta: a.meta || {} };
          }
        }
      } catch (err) {
        console.warn("createSignedUrl err", err);
      }
      // fallback: return object_path (may be public)
      return { id: a.id, url: a.object_path || null, meta: a.meta || {} };
    }));

    return NextResponse.json({ ok: true, id: collection.id, name: collection.name, assets: signedAssets.filter(Boolean) });
  } catch (err) {
    console.error("GET model route error", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
