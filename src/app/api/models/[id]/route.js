// src/app/api/models/[id]/route.js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

/** parse cookie header into map */
function parseCookies(cookieHeader = "") {
  if (!cookieHeader) return {};
  return cookieHeader
    .split(";")
    .map(s => s.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const idx = pair.indexOf("=");
      if (idx === -1) return acc;
      const name = decodeURIComponent(pair.slice(0, idx).trim());
      const val = decodeURIComponent(pair.slice(idx + 1).trim());
      acc[name] = val;
      acc[name.toLowerCase()] = val;
      return acc;
    }, {});
}

/** Extract real access token from various cookie shapes:
 * - sb-access-token
 * - sb-debug-access (dev debug cookie)
 * - sb-<proj>-auth-token => value prefixed "base64-<base64json>" (decode JSON)
 * - fallback: any long cookie value
 */
function extractAccessTokenFromCookies(cookies) {
  if (!cookies || typeof cookies !== "object") return null;

  // 1) explicit sb-access-token
  if (cookies["sb-access-token"]) return cookies["sb-access-token"];
  if (cookies["sb-access-token".toLowerCase()]) return cookies["sb-access-token".toLowerCase()];

  // 2) debug token (dev only)
  if (cookies["sb-debug-access"]) return cookies["sb-debug-access"];

  // 3) any cookie name that ends with -auth-token (typical supabase helper wrapper)
  const authKey = Object.keys(cookies).find(k => k && k.toLowerCase().endsWith("-auth-token"));
  if (authKey) {
    const raw = cookies[authKey];
    if (!raw) return null;
    // pattern: "base64-<base64json>"
    if (raw.startsWith("base64-")) {
      try {
        const b64 = raw.slice("base64-".length);
        const decoded = Buffer.from(b64, "base64").toString("utf8");
        const parsed = JSON.parse(decoded);
        // common shapes:
        if (parsed?.access_token) return parsed.access_token;
        if (parsed?.accessToken) return parsed.accessToken;
        if (parsed?.session?.access_token) return parsed.session.access_token;
        // sometimes nested under "currentSession" or other keys -> try to search
        const maybe = (obj) => {
          for (const v of Object.values(obj || {})) {
            if (v && typeof v === "object") {
              if (v.access_token) return v.access_token;
              if (v.session?.access_token) return v.session.access_token;
            }
          }
          return null;
        };
        const found = maybe(parsed) || maybe(parsed?.session) || null;
        if (found) return found;
      } catch (e) {
        console.warn("[api/models/[id]] failed to decode base64 auth-token cookie", e);
      }
    } else {
      // if it's not base64 wrapper, maybe cookie itself is the token
      return raw;
    }
  }

  // 4) fallback: pick any cookie value that looks long enough to be a token
  const candidate = Object.keys(cookies).find(k => cookies[k] && cookies[k].length > 100);
  if (candidate) return cookies[candidate];

  return null;
}

export async function GET(request, { params }) {
  try {
    // params may be an async-like object — await it
    const resolvedParams = await params;
    const modelId = resolvedParams?.id;
    console.log("[api/models/[id]] request.url:", request.url);
    console.log("[api/models/[id]] resolvedParams:", resolvedParams);
    console.log("[api/models/[id]] modelId:", modelId);

    if (!modelId) {
      console.warn("[api/models/[id]] Missing id");
      return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
    }

    // parse cookies
    const cookieHeader = request.headers.get("cookie") || "";
    console.log("[api/models/[id]] raw Cookie header present:", !!cookieHeader);
    if (cookieHeader) {
      // print truncated for safety
      console.log("[api/models/[id]] raw Cookie (truncated):", cookieHeader.slice(0, 300) + (cookieHeader.length > 300 ? "…(truncated)" : ""));
    }
    const cookies = parseCookies(cookieHeader);
    console.log("[api/models/[id]] cookie keys:", Object.keys(cookies));

    const accessToken = extractAccessTokenFromCookies(cookies);
    console.log("[api/models/[id]] extracted access token present:", !!accessToken, accessToken ? `len=${accessToken.length}` : 0);

    if (!accessToken) {
      console.warn("[api/models/[id]] Unauthorized — no access token found in cookies");
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // validate token using service-role client
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (userErr) {
      console.error("[api/models/[id]] supabaseAdmin.auth.getUser error:", userErr);
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

    // normalize asset_ids and fetch assets
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
          console.log("[api/models/[id]] signing asset", { id: a.id, bucket: a.bucket, object_path: a.object_path });
          const { data: signed, error: signErr } = await supabaseAdmin
            .storage
            .from(a.bucket)
            .createSignedUrl(a.object_path, signedExpirySec);

          if (signErr) {
            console.warn("[api/models/[id]] createSignedUrl error for", a.id, signErr);
          }
          if (signed?.signedUrl) {
            return { id: a.id, url: signed.signedUrl, meta: a.meta || {} };
          }
        }
      } catch (err) {
        console.warn("[api/models/[id]] createSignedUrl unexpected err", err);
      }
      // fallback: return object_path (may be public)
      return { id: a.id, url: a.object_path || null, meta: a.meta || {} };
    }));

    return NextResponse.json({ ok: true, id: collection.id, name: collection.name, assets: signedAssets.filter(Boolean) });
  } catch (err) {
    console.error("[api/models/[id]] GET error", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
