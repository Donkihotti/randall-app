// src/app/api/subject/[id]/signed-url/route.js
import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/subject/:id/signed-url?path=<object_path>&expires=<seconds>
 *
 * - Verifies the requester is the owner of the subject (via RLS/auth helper).
 * - Uses the SUPABASE_SERVICE_ROLE_KEY to create a signed URL for the given storage object.
 *
 * Query params:
 * - path (required): object path *inside the bucket* (e.g. "refs/sub_xxx/foo.png" or "generated/sub_xxx/..png")
 *   - MUST NOT be a full http(s) URL. Pass the storage object path only.
 * - expires (optional): signed URL TTL in seconds (default 60, max 3600)
 *
 * Environment required:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 *
 * Security:
 * - This endpoint enforces subject ownership via the authenticated user (createRouteHandlerClient).
 * - Service role key is used only server-side to create the signed URL.
 */

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "models";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  console.warn("SUPABASE_URL not set");
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("SUPABASE_SERVICE_ROLE_KEY not set — signed URL endpoint will fail without it");
}

export async function GET(req, context) {
  try {
    // route-authenticated client (will run under the caller's identity)
    const supabase = createRouteHandlerClient({ cookies });

    // ensure authenticated user
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    // params
    const params = context?.params;
    const resolvedParams = params && typeof params.then === "function" ? await params : params;
    const { id } = resolvedParams || {};
    if (!id) return NextResponse.json({ error: "Missing subject id in route" }, { status: 400 });

    // query params
    const url = new URL(req.url);
    const objectPathRaw = url.searchParams.get("path") || url.searchParams.get("key");
    if (!objectPathRaw) {
      return NextResponse.json({ error: "Missing 'path' query param (storage object path inside bucket)" }, { status: 400 });
    }

    // sanitize path: reject absolute http URLs
    if (/^https?:\/\//i.test(objectPathRaw)) {
      return NextResponse.json({ error: "Pass storage object path (e.g. 'refs/sub_xxx/file.png'), not a full URL" }, { status: 400 });
    }

    // normalize path
    let objectPath = objectPathRaw.replace(/^\/+/, ""); // remove leading slashes
    // basic traversal protection
    if (objectPath.includes("..")) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    // ensure subject belongs to user by selecting the row (RLS enforced)
    const { data: subject, error: subErr } = await supabase
      .from("subjects")
      .select("id, owner_id")
      .eq("id", id)
      .single();

    if (subErr) {
      console.error("subject lookup error:", subErr);
      return NextResponse.json({ error: "Subject not found or access denied" }, { status: 404 });
    }

    // optional: ensure the objectPath visually matches subject id (not required but a sanity check)
    // e.g. we expect uploaded refs to live under refs/{subjectId}/..; skip if not structured that way.
    // if (!objectPath.includes(id)) { /* maybe warn, but still allow if desired */ }

    // create admin client to generate signed url
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Server misconfigured: SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 500 });
    }
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // expires param
    let expires = 60; // default 60s
    const expiresParam = url.searchParams.get("expires");
    if (expiresParam) {
      const parsed = Number(expiresParam);
      if (!Number.isNaN(parsed) && parsed > 0) expires = Math.min(parsed, 3600); // max 1hr
    }

    // create signed url
    const { data, error } = await adminClient.storage.from(BUCKET).createSignedUrl(objectPath, expires);

    if (error || !data?.signedURL && !data?.signedUrl && !data?.signed_url) {
      // support a few variants of returned field name across SDK versions
      console.error("createSignedUrl error", error || data);
      return NextResponse.json({ error: "Failed to create signed URL" }, { status: 500 });
    }

    // normalize returned URL field
    const signedUrl = data.signedURL || data.signedUrl || data.signed_url;

    return NextResponse.json({ ok: true, url: signedUrl, expires_in: expires }, { status: 200 });
  } catch (err) {
    console.error("signed-url route error:", err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
