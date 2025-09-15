// src/app/api/photoshoots/[id]/base/route.js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

/* ---------- cookie helpers (robust) ---------- */
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

function extractAccessTokenFromCookies(cookies = {}) {
  if (!cookies || typeof cookies !== "object") return null;
  if (cookies["sb-access-token"]) return cookies["sb-access-token"];
  if (cookies["sb-debug-access"]) return cookies["sb-debug-access"];
  const authKey = Object.keys(cookies).find(k => k && k.toLowerCase().endsWith("-auth-token"));
  if (authKey) {
    const raw = cookies[authKey];
    if (!raw) return null;
    if (raw.startsWith("base64-")) {
      try {
        const b64 = raw.slice("base64-".length);
        const dec = Buffer.from(b64, "base64").toString("utf8");
        const parsed = JSON.parse(dec);
        if (parsed?.access_token) return parsed.access_token;
        if (parsed?.session?.access_token) return parsed.session.access_token;
      } catch (e) {
        console.warn("[photoshoots/base] failed to decode base64 cookie", e);
      }
    } else {
      return raw;
    }
  }
  const candidate = Object.keys(cookies).find(k => cookies[k] && cookies[k].length > 100);
  if (candidate) return cookies[candidate];
  return null;
}

async function getUserIdFromRequest(request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookies = parseCookies(cookieHeader);
  const accessToken = extractAccessTokenFromCookies(cookies);
  if (!accessToken) throw new Error("no_access_token");

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (userErr) {
    console.error("[photoshoots/base] auth.getUser error:", userErr);
    throw new Error("invalid_token");
  }
  const userId = userData?.user?.id;
  if (!userId) throw new Error("invalid_user");
  return userId;
}

/* PATCH: set base asset (or thumbnail) on photoshoot */
export async function PATCH(request, { params }) {
  try {
    const photoshootId = params?.id;
    if (!photoshootId) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

    const userId = await getUserIdFromRequest(request);

    const body = await request.json().catch(() => ({}));
    const baseAssetId = (body.base_asset_id || body.asset_id || "").toString().trim();
    if (!baseAssetId) return NextResponse.json({ ok: false, error: "base_asset_id required" }, { status: 400 });

    // verify photoshoot exists and owner
    const { data: ps, error: psErr } = await supabaseAdmin
      .from("photoshoots")
      .select("id, owner_id")
      .eq("id", photoshootId)
      .limit(1)
      .maybeSingle();

    if (psErr) {
      console.error("[photoshoots/base] photoshoot lookup error", psErr);
      return NextResponse.json({ ok: false, error: "Failed to fetch photoshoot" }, { status: 500 });
    }
    if (!ps) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (String(ps.owner_id) !== String(userId)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    // update photoshoot row: set base_asset_id and maybe thumbnail_asset_id for compatibility
    const updates = {
      base_asset_id: baseAssetId,
      thumbnail_asset_id: baseAssetId,
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error: updErr } = await supabaseAdmin
      .from("photoshoots")
      .update(updates)
      .eq("id", photoshootId)
      .select()
      .limit(1)
      .maybeSingle();

    if (updErr) {
      console.error("[photoshoots/base] update error", updErr);
      return NextResponse.json({ ok: false, error: "Failed to update photoshoot" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, photoshoot: updated }, { status: 200 });
  } catch (err) {
    console.error("[photoshoots/base] unexpected", err);
    const msg = err?.message || String(err);
    if (msg === "no_access_token" || msg === "invalid_token" || msg === "invalid_user")
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
