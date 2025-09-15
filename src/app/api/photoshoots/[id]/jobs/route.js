// src/app/api/photoshoots/[id]/jobs/route.js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

/* ---------- cookie helpers (same robust approach) ---------- */
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
  // supabase cookie name ending in -auth-token
  const authKey = Object.keys(cookies).find((k) => k && k.toLowerCase().endsWith("-auth-token"));
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
        for (const v of Object.values(parsed || {})) {
          if (v && typeof v === "object") {
            if (v.access_token) return v.access_token;
            if (v.session?.access_token) return v.session.access_token;
          }
        }
      } catch (e) {
        console.warn("[jobs/route] failed to decode base64 cookie", e);
      }
    } else {
      return raw;
    }
  }
  // fallback: any long cookie-like value
  const candidate = Object.keys(cookies).find((k) => cookies[k] && cookies[k].length > 100);
  if (candidate) return cookies[candidate];
  return null;
}

async function getUserIdFromRequest(request) {
  const cookieHeader = request.headers.get("cookie") || "";
  console.log(
    "[jobs/route] raw cookie header (truncated):",
    cookieHeader ? cookieHeader.slice(0, 300) + (cookieHeader.length > 300 ? "…" : "") : "(none)"
  );
  const cookies = parseCookies(cookieHeader);
  console.log("[jobs/route] cookie keys:", Object.keys(cookies));
  const accessToken =
    (request.headers.get("authorization") || "").toLowerCase().startsWith("bearer ")
      ? (request.headers.get("authorization") || "").slice(7).trim()
      : extractAccessTokenFromCookies(cookies);

  console.log("[jobs/route] extracted access token present:", !!accessToken);
  if (!accessToken) throw new Error("no_access_token");

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (userErr) {
    console.error("[jobs/route] auth.getUser error:", userErr);
    throw new Error("invalid_token");
  }
  const userId = userData?.user?.id;
  if (!userId) throw new Error("invalid_user");
  return userId;
}

/* allow preflight (if browser sends OPTIONS for POST) */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    const photoshootId = resolvedParams?.id;
    console.log("[api/photoshoots/:id/jobs] POST incoming, photoshootId:", photoshootId);
    if (!photoshootId) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

    // validate user from cookie / authorization header
    const userId = await getUserIdFromRequest(request);
    console.log("[api/photoshoots/:id/jobs] authenticated userId:", userId);

    const body = await request.json().catch(() => ({}));

    // Accept the fields the client may send
    const shotsRaw = Number(body.shots ?? 1);
    const MIN_SHOTS = 1;
    const MAX_SHOTS = 50;
    const shots = Number.isFinite(shotsRaw) ? Math.max(MIN_SHOTS, Math.min(MAX_SHOTS, Math.floor(shotsRaw))) : 1;

    const prompt = body.prompt ? String(body.prompt) : null;
    const style = body.style ? String(body.style) : null;
    const type = body.type ? String(body.type) : null; // e.g. "base" | "variation" | null
    const reference_asset_id = body.reference_asset_id ? String(body.reference_asset_id) : null;
    const reference_collection_id = body.reference_collection_id ? String(body.reference_collection_id) : null;
    const parameters = body.parameters && typeof body.parameters === "object" ? body.parameters : null;
    const priority = Number.isFinite(Number(body.priority)) ? Number(body.priority) : 100;

    // verify photoshoot exists and ownership
    const { data: photoshoot, error: psErr } = await supabaseAdmin
      .from("photoshoots")
      .select("id, owner_id, status")
      .eq("id", photoshootId)
      .limit(1)
      .maybeSingle();

    if (psErr) {
      console.error("[api/photoshoots/:id/jobs] photoshoot lookup error:", psErr);
      return NextResponse.json({ ok: false, error: "Failed to fetch photoshoot" }, { status: 500 });
    }
    if (!photoshoot) return NextResponse.json({ ok: false, error: "Photoshoot not found" }, { status: 404 });
    if (String(photoshoot.owner_id) !== String(userId)) {
      console.warn("[api/photoshoots/:id/jobs] Forbidden owner mismatch", { photoshootOwner: photoshoot.owner_id, userId });
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    // build job row
    const jobRow = {
      photoshoot_id: photoshootId,
      owner_id: userId,
      status: "queued",
      shots,
      prompt,
      style,
      type,
      reference_asset_id,
      reference_collection_id,
      parameters,
      priority,
      created_at: new Date().toISOString(),
      // started_at / finished_at left null until worker updates
    };

    const { data: jobCreated, error: jobErr } = await supabaseAdmin
      .from("photoshoot_jobs")
      .insert([jobRow])
      .select()
      .limit(1)
      .maybeSingle();

    if (jobErr) {
      console.error("[api/photoshoots/:id/jobs] insert job error:", jobErr);
      return NextResponse.json({ ok: false, error: "Failed to enqueue job", dev: jobErr }, { status: 500 });
    }

    console.log("[api/photoshoots/:id/jobs] job queued:", jobCreated?.id);

    // best-effort: mark photoshoot status queued (so UI can show) — ignore errors
    try {
      await supabaseAdmin.from("photoshoots").update({ status: "queued", updated_at: new Date().toISOString() }).eq("id", photoshootId);
    } catch (uErr) {
      console.warn("[api/photoshoots/:id/jobs] warning: failed to update photoshoot.status", uErr);
    }

    return NextResponse.json({ ok: true, job: jobCreated }, { status: 201 });
  } catch (err) {
    console.error("[api/photoshoots/:id/jobs] unexpected error:", err);
    const msg = err?.message || String(err);
    if (msg === "no_access_token" || msg === "invalid_token" || msg === "invalid_user")
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
