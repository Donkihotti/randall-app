// src/app/api/photoshoots/route.js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Server supabase admin client (service role) — same pattern as your projects route.
 * Make sure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are present in .env.local.
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

  // common direct cookie names (quick wins)
  if (cookies["sb-access-token"]) return cookies["sb-access-token"];
  if (cookies["sb-debug-access"]) return cookies["sb-debug-access"];

  // supabase cookie pattern: "sb-<projectid>-auth-token"
  const authKey = Object.keys(cookies).find((k) => k && k.toLowerCase().endsWith("-auth-token"));
  if (authKey) {
    const raw = cookies[authKey];
    if (!raw) return null;

    // supabase sometimes stores base64-<json> payload
    if (raw.startsWith("base64-")) {
      try {
        const b64 = raw.slice("base64-".length);
        // Buffer should be available in Node runtime
        const dec = (typeof Buffer !== "undefined")
          ? Buffer.from(b64, "base64").toString("utf8")
          : atob(b64); // fallback (unlikely)
        const parsed = JSON.parse(dec);
        if (parsed?.access_token) return parsed.access_token;
        if (parsed?.session?.access_token) return parsed.session.access_token;
        // scan nested objects
        for (const v of Object.values(parsed || {})) {
          if (v && typeof v === "object") {
            if (v.access_token) return v.access_token;
            if (v.session?.access_token) return v.session.access_token;
          }
        }
      } catch (e) {
        console.warn("[photoshoots/route] failed to decode base64 cookie", e);
      }
    } else {
      // raw token stored directly
      return raw;
    }
  }

  // fallback: find any cookie that looks token-like (longish)
  const candidate = Object.keys(cookies).find((k) => cookies[k] && cookies[k].length > 100);
  if (candidate) return cookies[candidate];

  return null;
}

/* ---------- validate user from request (returns userId or throws) ---------- */
async function getUserIdFromRequest(request) {
  const cookieHeader = request.headers.get("cookie") || "";
  console.log("[photoshoots/route] raw cookie header (truncated):", cookieHeader ? cookieHeader.slice(0, 300) + (cookieHeader.length > 300 ? "…" : "") : "(none)");

  const cookies = parseCookies(cookieHeader);
  console.log("[photoshoots/route] cookie keys:", Object.keys(cookies));

  // prefer Authorization header if present
  const authHeader = (request.headers.get("authorization") || "").trim();
  const tokenFromHeader = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : null;

  const accessToken = tokenFromHeader || extractAccessTokenFromCookies(cookies);
  console.log("[photoshoots/route] extracted access token present:", !!accessToken);
  if (!accessToken) throw new Error("no_access_token");

  // use supabase admin client to validate token and fetch user
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (userErr) {
    console.error("[photoshoots/route] auth.getUser error:", userErr);
    throw new Error("invalid_token");
  }
  const userId = userData?.user?.id;
  if (!userId) throw new Error("invalid_user");
  return userId;
}

/* ---------- OPTIONS: respond to preflight (helps avoid 405 during dev) ---------- */
export async function OPTIONS(request) {
  console.log("[api/photoshoots] OPTIONS preflight");
  return new NextResponse(null, { status: 204 });
}

/* ---------- POST: create a new photoshoot (standalone or under a project) ---------- */
export async function POST(request) {
  try {
    console.log("[api/photoshoots] POST request");

    // authenticate
    let userId;
    try {
      userId = await getUserIdFromRequest(request);
      console.log("[api/photoshoots] authenticated userId:", userId);
    } catch (e) {
      console.warn("[api/photoshoots] auth failure:", e.message || String(e));
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const project_id = body.project_id ?? null; // nullable
    const name = (body.name || "").toString().trim();
    const description = body.description ?? null;
    const prompt = body.prompt ?? null;
    const prompt_meta = body.prompt_meta && typeof body.prompt_meta === "object" ? body.prompt_meta : null;
    const reference_collection_ids = Array.isArray(body.reference_collection_ids) ? body.reference_collection_ids : null;
    const parameters = body.parameters && typeof body.parameters === "object" ? body.parameters : null;

    if (!name) {
      return NextResponse.json({ ok: false, error: "Name is required" }, { status: 400 });
    }

    const insertRow = {
      project_id,
      owner_id: userId,
      name,
      description,
      prompt,
      prompt_meta,
      reference_collection_ids,
      parameters,
      status: "queued",
      result_summary: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: created, error } = await supabaseAdmin
      .from("photoshoots")
      .insert([insertRow])
      .select()
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[api/photoshoots] insert error:", error);
      return NextResponse.json({ ok: false, error: "Failed to create photoshoot", dev: { message: error?.message, details: error?.details } }, { status: 500 });
    }

    console.log("[api/photoshoots] created photoshoot id:", created?.id);
    return NextResponse.json({ ok: true, photoshoot: created }, { status: 201 });
  } catch (err) {
    console.error("[api/photoshoots] unexpected:", err);
    const msg = err?.message || String(err);
    if (msg === "no_access_token" || msg === "invalid_token" || msg === "invalid_user")
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/* ---------- GET: list photoshoots for authenticated user (optional filter: ?projectId=...) ---------- */
export async function GET(request) {
  try {
    console.log("[api/photoshoots] GET request");
    let userId;
    try {
      userId = await getUserIdFromRequest(request);
      console.log("[api/photoshoots] authenticated userId:", userId);
    } catch (e) {
      console.warn("[api/photoshoots] auth failure:", e.message || String(e));
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") || null;

    let query = supabaseAdmin
      .from("photoshoots")
      .select("id, project_id, owner_id, name, description, prompt, prompt_meta, reference_collection_ids, parameters, status, result_summary, created_at, updated_at")
      .eq("owner_id", userId);

    if (projectId) query = query.eq("project_id", projectId);

    query = query.order("created_at", { ascending: false });

    const { data: photoshoots, error } = await query;

    if (error) {
      console.error("[api/photoshoots] db query error:", error);
      return NextResponse.json({ ok: false, error: "Failed to fetch photoshoots" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, photoshoots });
  } catch (err) {
    console.error("[api/photoshoots] unexpected:", err);
    const msg = err?.message || String(err);
    if (msg === "no_access_token" || msg === "invalid_token" || msg === "invalid_user")
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
