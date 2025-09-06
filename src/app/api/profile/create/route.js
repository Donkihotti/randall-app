import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Ensure these env vars exist in your environment (use next.config or .env.local)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function sanitizeString(s = "") {
  // simple sanitize: strip <tags> and trim
  return String(s || "").replace(/<[^>]*>/g, "").trim();
}

function validateUsername(username) {
  if (!username) return "Username is required";
  if (username.length < 3 || username.length > 30) return "Username must be 3-30 characters";
  // allowed characters: alphanum and dot/underscore/hyphen
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) return "Username may contain letters, numbers, '.', '_' and '-'";
  return null;
}

export async function POST(req) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.split(" ")[1] : null;
    if (!token) {
      return NextResponse.json({ error: "Missing access token (Authorization: Bearer <token>)" }, { status: 401 });
    }

    const body = await req.json();
    const rawUsername = sanitizeString(body?.username || "");
    const displayName = sanitizeString(body?.displayName || "");
    const bio = sanitizeString(body?.bio || "");
    const username = rawUsername.toLowerCase();

    // input validation
    const usernameErr = validateUsername(username);
    if (usernameErr) {
      return NextResponse.json({ error: usernameErr }, { status: 400 });
    }
    if (displayName.length > 100) {
      return NextResponse.json({ error: "Display name too long (max 100)" }, { status: 400 });
    }
    if (bio.length > 500) {
      return NextResponse.json({ error: "Bio too long (max 500)" }, { status: 400 });
    }

    // verify token => get user
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      console.warn("Invalid access token", userErr);
      return NextResponse.json({ error: "Invalid access token" }, { status: 401 });
    }
    const user = userData.user;
    const userId = user.id;

    // ensure username uniqueness (exclude current user's id)
    const { data: existing, error: selErr } = await supabase
      .from("profiles")
      .select("id, username")
      .eq("username", username)
      .limit(1);

    if (selErr) {
      console.error("Database error checking username:", selErr);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
    if (existing && existing.length && existing[0].id !== userId) {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    }

    // Upsert profile as service role
    const payload = {
      id: userId,
      username,
      display_name: displayName || null,
      bio: bio || null,
      updated_at: new Date().toISOString(),
    };

    const { data: upserted, error: upErr } = await supabase
      .from("profiles")
      .upsert(payload, { returning: "representation" });

    if (upErr) {
      console.error("Upsert error:", upErr);
      return NextResponse.json({ error: "Failed to create or update profile" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, profile: (upserted && upserted[0]) || null });
  } catch (err) {
    console.error("profile create route error:", err);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
