// src/app/api/subject/[id]/assets/[assetId]/accept/route.js
import { NextResponse } from "next/server";
import { createServerSupabase } from "../../../../../../../../utils/supabase/server";
import { supabaseAdmin } from "../../../../../../../../lib/supabaseServer";

export async function POST(req, { params }) {
  try {
    // Await params to satisfy Next.js dynamic route requirement
    const resolvedParams = params && typeof params.then === "function" ? await params : params;
    const { id: subjectId, assetId } = resolvedParams || {};

    const supabase = await createServerSupabase();
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr) console.warn("accept asset: auth.getUser error", userErr);
    const user = userData?.user;
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!subjectId || !assetId) return NextResponse.json({ error: "Missing params" }, { status: 400 });

    // Verify asset belongs to subject and subject belongs to user
    const { data: assetRow, error: assetErr } = await supabaseAdmin
      .from("assets")
      .select("*")
      .eq("id", assetId)
      .single();

    if (assetErr || !assetRow) {
      console.warn("accept asset: asset not found", assetErr);
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    if (String(assetRow.subject_id) !== String(subjectId)) {
      return NextResponse.json({ error: "Asset does not belong to subject" }, { status: 400 });
    }

    // Ensure user owns the subject (double-check)
    const { data: subjectRow, error: subjErr } = await supabaseAdmin
      .from("subjects")
      .select("id, owner_id")
      .eq("id", subjectId)
      .single();

    if (subjErr || !subjectRow) {
      console.warn("accept asset: subject not found", subjErr);
      return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    }
    if (String(subjectRow.owner_id) !== String(user.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const nowIso = new Date().toISOString();

    // 1) Mark all subject assets of this type inactive (we only want one 'active' generated asset)
    //    then mark this asset active.
    try {
      await supabaseAdmin
        .from("assets")
        .update({ active: false, updated_at: nowIso })
        .eq("subject_id", subjectId)
        .eq("type", assetRow.type);
    } catch (e) {
      console.warn("accept asset: failed to deactivate others", e);
      // not fatal — proceed
    }

    const { data: activated, error: activateErr } = await supabaseAdmin
      .from("assets")
      .update({ active: true, updated_at: nowIso })
      .eq("id", assetId)
      .select()
      .single();

    if (activateErr || !activated) {
      console.error("accept asset: failed to activate asset", activateErr);
      return NextResponse.json({ error: "Failed to activate asset" }, { status: 500 });
    }

    // 2) Update subject status so worker or uploader will generate sheet next
    const newStatus = "queued_generation";
    try {
      await supabaseAdmin
        .from("subjects")
        .update({ status: newStatus, updated_at: nowIso })
        .eq("id", subjectId);
    } catch (e) {
      console.warn("accept asset: failed to update subject status", e);
      // Not fatal — continue
    }

    // 3) Enqueue a job to start sheet generation immediately (include created_by to satisfy schema/triggers)
    let jobId = null;
    try {
      const { data: jobRow, error: jobErr } = await supabaseAdmin
        .from("jobs")
        .insert([
          {
            subject_id: subjectId,
            type: "generate-sheet",
            payload: { accepted_asset_id: assetId },
            status: "queued",
            created_by: user.id,     // <<< IMPORTANT: include created_by
          },
        ])
        .select()
        .single();

      if (!jobErr && jobRow) jobId = jobRow.id;
      if (jobErr) console.warn("accept asset: enqueue job error", jobErr);
    } catch (e) {
      console.warn("accept asset: enqueue job exception", e);
    }

    // 4) Fetch fresh subject row (with minimal fields) to return to client
    let freshSubj = null;
    try {
      const { data: fs, error: freshErr } = await supabaseAdmin
        .from("subjects")
        .select("*")
        .eq("id", subjectId)
        .single();
      if (!freshErr && fs) freshSubj = fs;
    } catch (e) {
      console.warn("accept asset: failed to fetch fresh subject", e);
    }

    return NextResponse.json({ ok: true, jobId: jobId || null, subject: freshSubj || null });
  } catch (err) {
    console.error("accept asset route error:", err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
