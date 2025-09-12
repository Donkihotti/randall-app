// src/app/api/projects/route.js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

/* ---------- cookie helpers (same robust approach as other routes) ---------- */
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
        for (const v of Object.values(parsed || {})) {
          if (v && typeof v === "object") {
            if (v.access_token) return v.access_token;
            if (v.session?.access_token) return v.session.access_token;
          }
        }
      } catch (e) {
        console.warn("[projects/route] failed to decode base64 cookie", e);
      }
    } else {
      return raw;
    }
  }
  const candidate = Object.keys(cookies).find(k => cookies[k] && cookies[k].length > 100);
  if (candidate) return cookies[candidate];
  return null;
}

/* ---------- validate user from cookies (returns userId or throws) ---------- */
async function getUserIdFromRequest(request) {
  const cookieHeader = request.headers.get("cookie") || "";
  console.log("[projects/route] raw cookie header (truncated):", cookieHeader ? cookieHeader.slice(0,300) + (cookieHeader.length>300?"…": "") : "(none)");
  const cookies = parseCookies(cookieHeader);
  console.log("[projects/route] cookie keys:", Object.keys(cookies));
  const accessToken = extractAccessTokenFromCookies(cookies);
  console.log("[projects/route] extracted access token present:", !!accessToken);
  if (!accessToken) throw new Error("no_access_token");

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (userErr) {
    console.error("[projects/route] auth.getUser error:", userErr);
    throw new Error("invalid_token");
  }
  const userId = userData?.user?.id;
  if (!userId) throw new Error("invalid_user");
  return userId;
}

/* ---------- POST: create a new project ---------- */
export async function POST(request) {
  try {
    const userId = await getUserIdFromRequest(request);

    const body = await request.json().catch(() => ({}));
    const name = (body.name || "").toString().trim();
    const description = body.description ? body.description.toString().trim() : null;
    const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : null;

    console.log("[projects/POST] creating project for user:", userId, { name, hasDescription: !!description });

    if (!name) {
      return NextResponse.json({ ok: false, error: "Name is required" }, { status: 400 });
    }

    // Insert project with owner_id set server-side for security
    const { data, error } = await supabaseAdmin
      .from("projects")
      .insert([{ owner_id: userId, name, description, metadata }])
      .select()
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[projects/POST] db insert error:", error);
      return NextResponse.json({ ok: false, error: "Failed to create project" }, { status: 500 });
    }

    console.log("[projects/POST] created project:", data?.id);
    // respond with created project row
    return NextResponse.json({ ok: true, project: data }, { status: 201 });
  } catch (err) {
    console.error("[projects/POST] unexpected error:", err);
    const msg = err?.message || String(err);
    if (msg === "no_access_token" || msg === "invalid_token" || msg === "invalid_user")
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/* ---------- GET: list projects for authenticated user ---------- */
export async function GET(request) {
  try {
    const userId = await getUserIdFromRequest(request);
    console.log("[projects/GET] listing projects for user:", userId);

    const { data: projects, error } = await supabaseAdmin
      .from("projects")
      .select("id, owner_id, name, description, metadata, created_at, updated_at")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[projects/GET] db query error:", error);
      return NextResponse.json({ ok: false, error: "Failed to fetch projects" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, projects });
  } catch (err) {
    console.error("[projects/GET] unexpected:", err);
    const msg = err?.message || String(err);
    if (msg === "no_access_token" || msg === "invalid_token" || msg === "invalid_user")
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
