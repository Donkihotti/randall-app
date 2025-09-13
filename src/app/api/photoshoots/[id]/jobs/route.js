// src/app/api/photoshoots/[id]/jobs/route.js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").map(c => c.trim()).filter(Boolean).reduce((acc, pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return acc;
    const name = decodeURIComponent(pair.slice(0, idx).trim());
    const val = decodeURIComponent(pair.slice(idx + 1).trim());
    acc[name] = val;
    acc[name.toLowerCase()] = val;
    return acc;
  }, {});
}

async function getUserIdFromRequest(request) {
  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const cookieHeader = request.headers.get("cookie") || "";
  const cookies = parseCookies(cookieHeader);

  const tokenCandidate = bearer
    || cookies["sb-access-token"]
    || cookies["sb-auth-token"]
    || cookies[Object.keys(cookies).find(k => k && k.startsWith("sb-") && k.endsWith("-auth-token"))]
    || cookies[Object.keys(cookies).find(k => k && k.startsWith("sb-") && k.includes("auth"))];

  if (!tokenCandidate) return null;

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(tokenCandidate);
  if (userErr || !userData?.user?.id) {
    console.error("[api/photoshoots/[id]/jobs] auth.getUser error", userErr);
    return null;
  }
  return userData.user.id;
}

export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    const photoshootId = resolvedParams?.id;
    console.log("[api/photoshoots/[id]/jobs] request for photoshoot:", photoshootId);

    if (!photoshootId) return NextResponse.json({ ok: false, error: "Missing photoshoot id" }, { status: 400 });

    const userId = await getUserIdFromRequest(request);
    console.log("[api/photoshoots/[id]/jobs] authenticated user id:", userId);
    if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const type = (body.type || "generate").toString();
    const prompt = body.prompt ?? null;
    const parameters = body.parameters ?? null;
    const priority = Number(body.priority ?? 100);

    // ensure ownership of photoshoot
    const { data: photoshoot, error: psErr } = await supabaseAdmin
      .from("photoshoots")
      .select("id, owner_id")
      .eq("id", photoshootId)
      .limit(1)
      .maybeSingle();

    if (psErr) {
      console.error("[api/photoshoots/[id]/jobs] photoshoot fetch err", psErr);
      return NextResponse.json({ ok: false, error: "Failed to fetch photoshoot" }, { status: 500 });
    }
    if (!photoshoot) return NextResponse.json({ ok: false, error: "Photoshoot not found" }, { status: 404 });
    if (String(photoshoot.owner_id) !== String(userId)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    // enqueue job
    const { data: job, error: jobErr } = await supabaseAdmin
      .from("photoshoot_jobs")
      .insert([{
        photoshoot_id: photoshootId,
        owner_id: userId,
        type,
        status: "queued",
        priority,
        prompt,
        parameters,
      }])
      .select()
      .single();

    if (jobErr) {
      console.error("[api/photoshoots/[id]/jobs] insert job err", jobErr);
      return NextResponse.json({ ok: false, error: "Failed to create job" }, { status: 500 });
    }

    console.log("[api/photoshoots/[id]/jobs] enqueued job", job.id);
    return NextResponse.json({ ok: true, job });
  } catch (err) {
    console.error("[api/photoshoots/[id]/jobs] unexpected", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
