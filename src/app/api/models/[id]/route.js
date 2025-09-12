// src/app/api/models/[id]/route.js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

/** parse cookies into a map */
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

/** extract JWT from common Supabase cookie shapes */
function extractAccessTokenFromCookies(cookies = {}) {
  if (!cookies || typeof cookies !== "object") return null;

  // straight token names
  if (cookies["sb-access-token"]) return cookies["sb-access-token"];
  if (cookies["sb-debug-access"]) return cookies["sb-debug-access"];

  // cookie like sb-<proj>-auth-token => "base64-<json>"
  const authKey = Object.keys(cookies).find(k => k && k.toLowerCase().endsWith("-auth-token"));
  if (authKey) {
    const raw = cookies[authKey];
    if (!raw) return null;
    if (raw.startsWith("base64-")) {
      try {
        const b64 = raw.slice("base64-".length);
        const decoded = Buffer.from(b64, "base64").toString("utf8");
        const parsed = JSON.parse(decoded);
        if (parsed?.access_token) return parsed.access_token;
        if (parsed?.accessToken) return parsed.accessToken;
        if (parsed?.session?.access_token) return parsed.session.access_token;
        // search nested
        for (const v of Object.values(parsed || {})) {
          if (v && typeof v === "object") {
            if (v.access_token) return v.access_token;
            if (v.session?.access_token) return v.session.access_token;
          }
        }
      } catch (e) {
        console.warn("[api/models/[id]] failed to decode base64 cookie", e);
      }
    } else {
      // maybe cookie value is already token
      return raw;
    }
  }

  // fallback: any long cookie value
  const candidate = Object.keys(cookies).find(k => cookies[k] && cookies[k].length > 100);
  if (candidate) return cookies[candidate];

  return null;
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

    // read cookie and extract token
    const cookieHeader = request.headers.get("cookie") || "";
    console.log("[api/models/[id]] cookie header present:", !!cookieHeader);
    const cookies = parseCookies(cookieHeader);
    console.log("[api/models/[id]] cookie keys:", Object.keys(cookies));
    const accessToken = extractAccessTokenFromCookies(cookies);
    console.log("[api/models/[id]] extracted access token present:", !!accessToken, accessToken ? `len=${accessToken.length}` : 0);

    if (!accessToken) {
      console.warn("[api/models/[id]] Unauthorized — no access token found in cookies");
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // validate token using service role client (server-only)
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (userErr) {
      console.error("[api/models/[id]] supabaseAdmin.auth.getUser error:", userErr);
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const userId = userData?.user?.id;
    console.log("[api/models/[id]] authenticated user id:", userId);
    if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    // fetch the saved collection
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

    // normalize asset_ids
    let assetIds = collection.asset_ids;
    if (typeof assetIds === "string") {
      try { assetIds = JSON.parse(assetIds); } catch (e) { assetIds = []; }
    }
    if (!Array.isArray(assetIds) || assetIds.length === 0) {
      return NextResponse.json({ ok: true, id: collection.id, name: collection.name, assets: [] });
    }

    // fetch asset rows
    const { data: assetsRows, error: assetsErr } = await supabaseAdmin
      .from("assets")
      .select("id, bucket, object_path, filename, meta")
      .in("id", assetIds);

    if (assetsErr) {
      console.error("[api/models/[id]] assets fetch error", assetsErr);
      return NextResponse.json({ ok: false, error: "Failed to fetch assets" }, { status: 500 });
    }

    // build signed urls server-side (short expiry)
    const signedExpirySec = 60 * 60; // 1 hour
    const nowUnix = Math.floor(Date.now() / 1000);

    const signedAssets = await Promise.all((assetIds || []).map(async (aid) => {
      const a = (assetsRows || []).find(r => r.id === aid);
      if (!a) return null;

      // normalize object_path
      const objectPath = (a.object_path || "").toString().replace(/^\/+/, "");
      const bucket = (a.bucket || "").toString();

      try {
        let finalUrl = null;
        let signErr = null;
        let signData = null;

        if (bucket && objectPath) {
          const signRes = await supabaseAdmin.storage.from(bucket).createSignedUrl(objectPath, signedExpirySec);
          signData = signRes?.data ?? null;
          signErr = signRes?.error ?? null;

          if (signErr) {
            console.warn("[api/models/[id]] createSignedUrl returned error for", a.id, signErr);
          }

          // try many possible keys (SDK shape differences)
          finalUrl = signData && (
            signData.signedURL ||
            signData.signedUrl ||
            signData.signed_url ||
            signData.url ||
            signData.publicUrl ||
            signData.publicURL
          ) || null;

          // fallback to publicUrl getter if no finalUrl yet (public buckets)
          if (!finalUrl) {
            try {
              const pub = await supabaseAdmin.storage.from(bucket).getPublicUrl(objectPath);
              finalUrl = pub?.data?.publicUrl ?? finalUrl;
              if (finalUrl) console.log("[api/models/[id]] getPublicUrl fallback used for", a.id);
            } catch (e) {
              console.warn("[api/models/[id]] getPublicUrl error", e);
            }
          }
        }

        // last fallback: object_path (might be a direct public url or path)
        if (!finalUrl) finalUrl = objectPath || null;

        // attach expiry meta only when we produced a signed URL from createSignedUrl (not when using object_path)
        // We'll treat presence of signData.signedUrl/signedURL as indicator
        const producedSignedUrl = !!(signData && (signData.signedURL || signData.signedUrl || signData.url || signData.publicUrl));
        const expires_in = producedSignedUrl ? signedExpirySec : null;
        const expires_at = producedSignedUrl ? (nowUnix + expires_in) : null;

        return { id: a.id, url: finalUrl, meta: a.meta || {}, expires_in, expires_at };
      } catch (err) {
        console.warn("[api/models/[id]] createSignedUrl unexpected err for", aid, err);
        // fallback: return object_path if available
        return { id: a.id, url: a.object_path || null, meta: a.meta || {}, expires_in: null, expires_at: null };
      }
    }));

    return NextResponse.json({
      ok: true,
      id: collection.id,
      name: collection.name,
      assets: signedAssets.filter(Boolean),
    });
  } catch (err) {
    console.error("[api/models/[id]] GET error", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
