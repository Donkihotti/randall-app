// src/app/api/models/route.js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

/** parse cookie header into an object map */
function parseCookies(header = "") {
  if (!header) return {};
  return header
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const idx = pair.indexOf("=");
      if (idx === -1) return acc;
      const name = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      acc[name] = val;
      acc[name.toLowerCase()] = val;
      return acc;
    }, {});
}

/** Attempt to extract an access token from cookies. (same as before) */
function extractAccessTokenFromCookies(cookies) {
  if (cookies["sb-access-token"]) return cookies["sb-access-token"];
  if (cookies["sb-debug-access"]) return cookies["sb-debug-access"];
  const authTokenKey = Object.keys(cookies).find((k) => k && k.toLowerCase().endsWith("-auth-token"));
  if (authTokenKey) {
    const raw = cookies[authTokenKey];
    if (raw && raw.startsWith("base64-")) {
      try {
        const b64 = raw.slice("base64-".length);
        const decoded = Buffer.from(b64, "base64").toString("utf8");
        const parsed = JSON.parse(decoded);
        if (parsed?.access_token) return parsed.access_token;
        if (parsed?.accessToken) return parsed.accessToken;
        if (parsed?.session?.access_token) return parsed.session.access_token;
      } catch (e) {
        console.warn("[api/models] failed to decode base64 auth-token cookie", e);
      }
    } else {
      return raw;
    }
  }
  const candidateKey = Object.keys(cookies).find((k) => cookies[k] && cookies[k].length > 100);
  if (candidateKey) return cookies[candidateKey];
  return null;
}

/** Utility: safely create signed url, return null on any error */
async function createSignedUrlIfPossible(bucket, objectPath, expiresSec = 60 * 60) {
  if (!bucket || !objectPath) return null;
  try {
    const { data: signed, error: signErr } = await supabaseAdmin.storage.from(bucket).createSignedUrl(objectPath, expiresSec);
    if (signErr) {
      console.warn("[api/models] createSignedUrl error", signErr);
      return null;
    }
    // supabase returns { signedUrl } (camelCase). be defensive.
    return signed?.signedUrl ?? signed?.signedURL ?? null;
  } catch (e) {
    console.warn("[api/models] createSignedUrl threw", e);
    return null;
  }
}

export async function GET(request) {
  try {
    const cookieHeader = request.headers.get("cookie") || "";
    const cookies = parseCookies(cookieHeader);
    const accessToken = extractAccessTokenFromCookies(cookies);

    if (!accessToken) {
      return NextResponse.json({ ok: false, error: "Unauthorized: missing cookie" }, { status: 401 });
    }

    // validate token & user
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (userErr || !userData?.user?.id) {
      return NextResponse.json({ ok: false, error: "Unauthorized: invalid token" }, { status: 401 });
    }
    const userId = userData.user.id;

    // fetch saved_collections for this user; include thumbnail_asset_id & subject_id
    const { data: collections, error: modelsErr } = await supabaseAdmin
      .from("saved_collections")
      .select("id, owner_id, subject_id, asset_ids, name, created_at, thumbnail_asset_id")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false });

    if (modelsErr) {
      console.error("[api/models] DB error", modelsErr);
      return NextResponse.json({ ok: false, error: "Failed to fetch models" }, { status: 500 });
    }

    const results = [];

    for (const row of (collections || [])) {
      // asset_ids may be JSON string or array
      let assetIds = row.asset_ids;
      if (typeof assetIds === "string") {
        try {
          assetIds = JSON.parse(assetIds);
        } catch (e) {
          assetIds = [];
        }
      }
      if (!Array.isArray(assetIds)) assetIds = [];

      let thumbnail_url = null;

      // 1) Prefer saved_collections.thumbnail_asset_id if present
      let candidateAssetId = row.thumbnail_asset_id ?? null;

      // 2) If not set, fall back to subject.thumbnail_asset_id (if subject_id present)
      if (!candidateAssetId && row.subject_id) {
        try {
          const { data: subjRow, error: subjErr } = await supabaseAdmin
            .from("subjects")
            .select("thumbnail_asset_id")
            .eq("id", row.subject_id)
            .limit(1)
            .maybeSingle();
          if (!subjErr && subjRow && subjRow.thumbnail_asset_id) candidateAssetId = subjRow.thumbnail_asset_id;
        } catch (e) {
          // non-fatal
        }
      }

      // 3) last-resort: first element from asset_ids
      if (!candidateAssetId && assetIds.length) {
        candidateAssetId = assetIds[0];
      }

      // If we have an asset id candidate, fetch that asset row for bucket/object_path and generate signed url
      if (candidateAssetId) {
        try {
          const { data: assetRow, error: assetErr } = await supabaseAdmin
            .from("assets")
            .select("id, bucket, object_path")
            .eq("id", candidateAssetId)
            .limit(1)
            .maybeSingle();

          if (!assetErr && assetRow && assetRow.bucket && assetRow.object_path) {
            const url = await createSignedUrlIfPossible(assetRow.bucket, assetRow.object_path, 60 * 60);
            if (url) thumbnail_url = url;
          }
        } catch (e) {
          console.warn("[api/models] failed to fetch assetRow for thumbnail", e);
        }
      }

      results.push({
        id: row.id,
        owner_id: row.owner_id,
        subject_id: row.subject_id,
        name: row.name,
        created_at: row.created_at,
        asset_ids: row.asset_ids,
        thumbnail_url,
        thumbnail_asset_id: row.thumbnail_asset_id ?? null,
      });
    }

    return NextResponse.json({ ok: true, models: results });
  } catch (err) {
    console.error("[api/models] unexpected error", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
