// src/app/api/models/route.js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

/** parse cookie header into an object map */
function parseCookies(header = "") {
  if (!header) return {};
  return header.split(";").map(s => s.trim()).filter(Boolean).reduce((acc, pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return acc;
    const name = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    acc[name] = val;
    acc[name.toLowerCase()] = val;
    return acc;
  }, {});
}

/** Attempt to extract an access token from cookies.
 * Supports:
 * - sb-access-token (plain token)
 * - sb-<project>-auth-token = "base64-<base64json>" (Supabase helper style)
 * - sb-debug-access (debug cookie set in development)
 */
function extractAccessTokenFromCookies(cookies) {
  // 1) explicit sb-access-token
  if (cookies["sb-access-token"]) return cookies["sb-access-token"];
  if (cookies["sb-access-token".toLowerCase()]) return cookies["sb-access-token".toLowerCase()];

  // 2) debug cookie (short, not used in prod)
  if (cookies["sb-debug-access"]) return cookies["sb-debug-access"];

  // 3) try to find a cookie whose name ends with "-auth-token" (e.g., sb-<project>-auth-token)
  const authTokenKey = Object.keys(cookies).find(k => k && k.toLowerCase().endsWith("-auth-token"));
  if (authTokenKey) {
    const raw = cookies[authTokenKey];
    // Common pattern: value starts with "base64-" then base64(json)
    if (raw && raw.startsWith("base64-")) {
      try {
        const b64 = raw.slice("base64-".length);
        // Node environment (route.js) - Buffer available
        const decoded = Buffer.from(b64, "base64").toString("utf8");
        const parsed = JSON.parse(decoded);
        // supabase helper stores tokens under keys like "access_token" or "accessToken"
        if (parsed?.access_token) return parsed.access_token;
        if (parsed?.accessToken) return parsed.accessToken;
        // sometimes the base64 wrapper encodes an object with nested "session" etc.
        if (parsed?.session?.access_token) return parsed.session.access_token;
      } catch (e) {
        console.warn("[api/models] failed to decode base64 auth-token cookie", e);
      }
    } else {
      // if it's not base64-encoded, maybe the cookie *is* the access token
      return raw;
    }
  }

  // 4) last resort: check any cookie that looks like a long token (heuristic)
  const candidateKey = Object.keys(cookies).find(k => cookies[k] && cookies[k].length > 100);
  if (candidateKey) return cookies[candidateKey];

  return null;
}

export async function GET(request) {
  try {
    const cookieHeader = request.headers.get("cookie") || "";
    const cookies = parseCookies(cookieHeader);
    const accessToken = extractAccessTokenFromCookies(cookies);

    if (!accessToken) {
      return NextResponse.json({ ok: false, error: "Unauthorized: missing cookie" }, { status: 401 });
    }

    // validate token
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (userErr || !userData?.user?.id) {
      return NextResponse.json({ ok: false, error: "Unauthorized: invalid token" }, { status: 401 });
    }
    const userId = userData.user.id;

    // fetch saved_collections for this user
    const { data: models, error: modelsErr } = await supabaseAdmin
      .from("saved_collections")
      .select("id, owner_id, subject_id, asset_ids, name, created_at")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false });

    if (modelsErr) {
      console.error("[api/models] DB error", modelsErr);
      return NextResponse.json({ ok: false, error: "Failed to fetch models" }, { status: 500 });
    }

    // Build thumbnails (first asset -> signed url) when possible
    const results = [];
    for (const row of (models || [])) {
      let assetIds = row.asset_ids;
      if (typeof assetIds === "string") {
        try { assetIds = JSON.parse(assetIds); } catch (e) { assetIds = []; }
      }
      if (!Array.isArray(assetIds)) assetIds = [];

      let thumbnail_url = null;
      if (assetIds.length) {
        const firstId = assetIds[0];
        const { data: assetRow, error: assetErr } = await supabaseAdmin
          .from("assets")
          .select("id, bucket, object_path")
          .eq("id", firstId)
          .limit(1)
          .maybeSingle();

        if (!assetErr && assetRow && assetRow.bucket && assetRow.object_path) {
          try {
            const signedExpirySec = 60 * 60;
            const { data: signed, error: signErr } = await supabaseAdmin
              .storage
              .from(assetRow.bucket)
              .createSignedUrl(assetRow.object_path, signedExpirySec);
            if (!signErr && signed?.signedUrl) thumbnail_url = signed.signedurl;
          } catch (e) {
            console.warn("[api/models] createSignedUrl error", e);
          }
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
      });
    }

    return NextResponse.json({ ok: true, models: results });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
