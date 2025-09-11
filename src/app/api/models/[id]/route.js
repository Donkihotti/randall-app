// src/app/api/models/[id]/route.js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").map(c => c.trim()).filter(Boolean).reduce((acc, pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return acc;
    const name = decodeURIComponent(pair.slice(0, idx).trim());
    const val = decodeURIComponent(pair.slice(idx + 1).trim());
    acc[name] = val;
    acc[name.toLowerCase()] = val;
    return acc;
  }, {});
}

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params;
    const modelId = resolvedParams?.id;
    console.log("[api/models/[id]] request.url:", request.url);
    console.log("[api/models/[id]] resolvedParams:", resolvedParams);
    console.log("[api/models/[id]] modelId:", modelId);

    if (!modelId) {
      console.warn("[api/models/[id]] Missing id");
      return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
    }

    // read cookie and find access token
    const cookieHeader = request.headers.get("cookie") || "";
    const cookies = parseCookies(cookieHeader);
    const accessToken = cookies["sb-access-token"] || cookies["sb-access-token".toLowerCase()];
    console.log("[api/models/[id]] accessToken present:", !!accessToken);

    if (!accessToken) {
      console.warn("[api/models/[id]] Unauthorized — no access token cookie");
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (userErr) {
      console.error("[api/models/[id]] auth.getUser error", userErr);
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const userId = userData?.user?.id;
    console.log("[api/models/[id]] authenticated user id:", userId);
    if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    // fetch collection
    const { data: collection, error: collErr } = await supabaseAdmin
      .from("saved_collections")
      .select("id, owner_id, asset_ids, name, created_at")
      .eq("id", modelId)
      .limit(1)
      .maybeSingle();

    console.log("[api/models/[id]] collErr:", collErr);
    console.log("[api/models/[id]] collection:", collection);

    if (collErr) {
      console.error("[api/models/[id]] collection query error", collErr);
      return NextResponse.json({ ok: false, error: "Failed to fetch collection" }, { status: 500 });
    }
    if (!collection) {
      console.warn("[api/models/[id]] Not found for id:", modelId);
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    if (collection.owner_id !== userId) {
      console.warn("[api/models/[id]] Forbidden owner mismatch", { collectionOwner: collection.owner_id, userId });
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    // normalize asset_ids and fetch assets (same as your previous logic)
    let assetIds = collection.asset_ids;
    if (typeof assetIds === "string") {
      try { assetIds = JSON.parse(assetIds); } catch (e) { assetIds = []; }
    }
    if (!Array.isArray(assetIds) || assetIds.length === 0) {
      return NextResponse.json({ ok: true, id: collection.id, name: collection.name, assets: [] });
    }

    const { data: assetsRows, error: assetsErr } = await supabaseAdmin
      .from("assets")
      .select("id, bucket, object_path, filename, meta")
      .in("id", assetIds);

    if (assetsErr) {
      console.error("[api/models/[id]] assets fetch error", assetsErr);
      return NextResponse.json({ ok: false, error: "Failed to fetch assets" }, { status: 500 });
    }

    const signedExpirySec = 60 * 60; // 1 hour
    const signedAssets = await Promise.all((assetIds || []).map(async (aid) => {
      const a = (assetsRows || []).find(r => r.id === aid);
      if (!a) return null;
      try {
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
        console.warn("[api/models/[id]] createSignedUrl err", err);
      }
      return { id: a.id, url: a.object_path || null, meta: a.meta || {} };
    }));

    return NextResponse.json({ ok: true, id: collection.id, name: collection.name, assets: signedAssets.filter(Boolean) });
  } catch (err) {
    console.error("[api/models/[id]] GET error", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
