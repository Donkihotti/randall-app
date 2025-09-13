// src/app/api/photoshoots/[id]/route.js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Server supabase admin client (service role)
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

/* ---------- cookie helpers (robust) ---------- */
function parseCookies(cookieHeader = "") {
  if (!cookieHeader) return {};
  return cookieHeader
    .split(";")
    .map((s) => s.trim())
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

function extractAccessTokenFromCookies(cookies = {}) {
  if (!cookies || typeof cookies !== "object") return null;

  if (cookies["sb-access-token"]) return cookies["sb-access-token"];
  if (cookies["sb-debug-access"]) return cookies["sb-debug-access"];

  const authKey = Object.keys(cookies).find((k) => k && k.toLowerCase().endsWith("-auth-token"));
  if (authKey) {
    const raw = cookies[authKey];
    if (!raw) return null;
    // supabase sometimes stores "base64-<json>"
    if (raw.startsWith("base64-")) {
      try {
        const b64 = raw.slice("base64-".length);
        // Buffer exists in Node; safe in app routes
        const dec = Buffer.from(b64, "base64").toString("utf8");
        const parsed = JSON.parse(dec);
        if (parsed?.access_token) return parsed.access_token;
        if (parsed?.session?.access_token) return parsed.session.access_token;
        for (const v of Object.values(parsed || {})) {
          if (v && typeof v === "object") {
            if (v.access_token) return v.access_token;
            if (v.session?.access_token) return v.session.access_token;
          }
        }
      } catch (e) {
        console.warn("[photoshoots/[id]] failed to decode base64 cookie", e);
      }
    } else {
      return raw;
    }
  }

  const candidate = Object.keys(cookies).find((k) => cookies[k] && cookies[k].length > 100);
  if (candidate) return cookies[candidate];

  return null;
}

async function getUserIdFromRequest(request) {
  const cookieHeader = request.headers.get("cookie") || "";
  console.log("[photoshoots/[id]] raw cookie header (truncated):", cookieHeader ? cookieHeader.slice(0, 300) + (cookieHeader.length > 300 ? "…" : "") : "(none)");

  const cookies = parseCookies(cookieHeader);
  console.log("[photoshoots/[id]] cookie keys:", Object.keys(cookies));

  const authHeader = (request.headers.get("authorization") || "").trim();
  const tokenFromHeader = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : null;

  const accessToken = tokenFromHeader || extractAccessTokenFromCookies(cookies);
  console.log("[photoshoots/[id]] extracted access token present:", !!accessToken);
  if (!accessToken) throw new Error("no_access_token");

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (userErr) {
    console.error("[photoshoots/[id]] auth.getUser error:", userErr);
    throw new Error("invalid_token");
  }
  const userId = userData?.user?.id;
  if (!userId) throw new Error("invalid_user");
  return userId;
}

/* ---------- GET single photoshoot + signed assets ---------- */
export async function GET(request, { params }) {
  try {
    // Next can pass params as a Promise-like — await it to be safe
    const resolvedParams = await params;
    const photoshootId = resolvedParams?.id;
    console.log("[api/photoshoots/[id]] request.url:", request.url);
    console.log("[api/photoshoots/[id]] resolvedParams:", resolvedParams);

    if (!photoshootId) {
      console.warn("[api/photoshoots/[id]] Missing id");
      return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
    }

    // authenticate user
    let userId;
    try {
      userId = await getUserIdFromRequest(request);
      console.log("[api/photoshoots/[id]] authenticated user id:", userId);
    } catch (e) {
      console.warn("[api/photoshoots/[id]] auth failed:", e.message || e);
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // fetch photoshoot row and enforce ownership
    const { data: photoshoot, error: psErr } = await supabaseAdmin
      .from("photoshoots")
      .select("*")
      .eq("id", photoshootId)
      .limit(1)
      .maybeSingle();

    console.log("[api/photoshoots/[id]] photoshoot fetch err:", psErr, "photoshoot:", photoshoot);
    if (psErr) {
      console.error("[api/photoshoots/[id]] photoshoot fetch error", psErr);
      return NextResponse.json({ ok: false, error: "Failed to fetch photoshoot" }, { status: 500 });
    }
    if (!photoshoot) {
      console.warn("[api/photoshoots/[id]] Not found:", photoshootId);
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    if (String(photoshoot.owner_id) !== String(userId)) {
      console.warn("[api/photoshoots/[id]] Forbidden owner mismatch", { photoshootOwner: photoshoot.owner_id, userId });
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    // fetch photoshoot_assets join rows (include nested assets where possible)
    const { data: joinRows, error: joinErr } = await supabaseAdmin
      .from("photoshoot_assets")
      .select("id, photoshoot_id, asset_id, role, position, created_at, assets(id, bucket, object_path, filename, meta, mimetype, size_bytes, width, height, url)")
      .eq("photoshoot_id", photoshootId)
      .order("position", { ascending: true });

    if (joinErr) {
      console.error("[api/photoshoots/[id]] photoshoot_assets query error", joinErr);
      return NextResponse.json({ ok: false, error: "Failed to fetch assets" }, { status: 500 });
    }

    // normalize assetsRows:
    let assetsRows = [];
    if (Array.isArray(joinRows) && joinRows.length) {
      assetsRows = joinRows.map((j) => {
        const a = j.assets || { id: j.asset_id };
        return {
          photoshoot_asset_id: j.id,
          id: a.id,
          bucket: a.bucket,
          object_path: a.object_path,
          filename: a.filename,
          meta: a.meta || {},
          mimetype: a.mimetype || null,
          size_bytes: a.size_bytes || null,
          width: a.width || null,
          height: a.height || null,
          url_fallback: a.url || null,
          role: j.role || null,
          position: j.position ?? null,
        };
      });
    }

    // fallback: if joinRows exist but nested assets are missing, fetch assets table
    if ((!assetsRows || assetsRows.length === 0) && Array.isArray(joinRows) && joinRows.length) {
      const ids = joinRows.map((j) => j.asset_id).filter(Boolean);
      if (ids.length) {
        const { data: ar, error: arErr } = await supabaseAdmin
          .from("assets")
          .select("id, bucket, object_path, filename, meta, mimetype, size_bytes, width, height, url")
          .in("id", ids);
        if (arErr) {
          console.warn("[api/photoshoots/[id]] fallback assets fetch err", arErr);
        } else if (Array.isArray(ar)) {
          assetsRows = ar.map((a) => ({
            photoshoot_asset_id: null,
            id: a.id,
            bucket: a.bucket,
            object_path: a.object_path,
            filename: a.filename,
            meta: a.meta || {},
            mimetype: a.mimetype || null,
            size_bytes: a.size_bytes || null,
            width: a.width || null,
            height: a.height || null,
            url_fallback: a.url || null,
            role: null,
            position: null,
          }));
        }
      }
    }

    // create signed urls server-side (short expiry) and return expires_in/expires_at
    const signedExpirySec = 60 * 60; // 1 hour
    const signedAssets = await Promise.all((assetsRows || []).map(async (a) => {
      if (!a.bucket || !a.object_path) {
        return { id: a.id, url: a.url_fallback || null, meta: a.meta || {}, role: a.role, position: a.position, expires_in: null, expires_at: null };
      }
      try {
        const { data: signedRaw, error: signErr } = await supabaseAdmin
          .storage
          .from(a.bucket)
          .createSignedUrl(a.object_path, signedExpirySec);

        const signedURL = signedRaw?.signedUrl ?? signedRaw?.signedURL ?? null;
        if (signErr || !signedURL) {
          console.warn("[api/photoshoots/[id]] createSignedUrl err", signErr, signedRaw);
          return { id: a.id, url: a.url_fallback || null, meta: a.meta || {}, role: a.role, position: a.position, expires_in: null, expires_at: null };
        }

        const expires_in = signedExpirySec;
        const expires_at = new Date(Date.now() + signedExpirySec * 1000).toISOString();
        return { id: a.id, url: signedURL, meta: a.meta || {}, role: a.role, position: a.position, expires_in, expires_at };
      } catch (err) {
        console.warn("[api/photoshoots/[id]] createSignedUrl catch", err);
        return { id: a.id, url: a.url_fallback || null, meta: a.meta || {}, role: a.role, position: a.position, expires_in: null, expires_at: null };
      }
    }));

    // fetch recent jobs for this photoshoot (non-fatal)
    const { data: jobs, error: jobsErr } = await supabaseAdmin
      .from("photoshoot_jobs")
      .select("*")
      .eq("photoshoot_id", photoshootId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (jobsErr) {
      console.warn("[api/photoshoots/[id]] jobs fetch warning", jobsErr);
    }

    return NextResponse.json({ ok: true, photoshoot, assets: signedAssets.filter(Boolean), jobs: jobs || [] });
  } catch (err) {
    console.error("[api/photoshoots/[id]] GET error", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
