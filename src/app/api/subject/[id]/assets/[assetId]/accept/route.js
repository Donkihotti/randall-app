// src/app/api/subject/[id]/assets/[assetId]/accept/route.js
import { NextResponse } from "next/server";
import { createServerSupabase } from "../../../../../../../../utils/supabase/server";
import { supabaseAdmin } from "../../../../../../../../lib/supabaseServer";

/**
 * Helper: fetch assets for subject and ensure each asset has a usable signedUrl field.
 */
async function fetchAssetsWithSignedUrls(subjectId) {
  const { data: assets = [], error } = await supabaseAdmin
    .from("assets")
    .select("*")
    .eq("subject_id", subjectId)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("fetchAssetsWithSignedUrls: assets query error", error);
    return [];
  }

  const out = [];
  for (const a of assets) {
    const asset = { ...a };
    try {
      if (!asset.url && asset.object_path) {
        try {
          const { data: signedData, error: signErr } = await supabaseAdmin.storage
            .from(asset.bucket || "generated")
            .createSignedUrl(asset.object_path, 60 * 60);
          asset.signedUrl = (!signErr && signedData?.signedUrl) ? signedData.signedUrl : null;
        } catch (e) {
          asset.signedUrl = null;
        }
      } else {
        asset.signedUrl = asset.url || null;
      }
    } catch (e) {
      asset.signedUrl = asset.url || null;
    }
    out.push(asset);
  }
  return out;
}

export async function POST(req, { params }) {
  try {
    // NOTE: `params` is a promise-like in Next dynamic routes; await it before using its properties.
    const resolvedParams = params && typeof params.then === "function" ? await params : params;
    const supabase = await createServerSupabase();
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr) console.warn("accept asset: auth.getUser error", userErr);
    const user = userData?.user;
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: subjectId, assetId } = resolvedParams || {};
    if (!subjectId || !assetId) return NextResponse.json({ error: "Missing params" }, { status: 400 });

    // Load asset (service role)
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

    // Ensure subject exists and owner matches user
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

    // 1) Mark other assets of same type inactive for this subject (best-effort)
    try {
      const { error: deactivateErr } = await supabaseAdmin
        .from("assets")
        .update({ active: false, updated_at: nowIso })
        .eq("subject_id", subjectId)
        .eq("type", assetRow.type);
      if (deactivateErr) console.warn("accept asset: failed to deactivate others", deactivateErr);
    } catch (e) {
      console.warn("accept asset: deactivate exception", e);
    }

    // 2) Activate the chosen asset
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

    // 3) Enqueue a generate-sheet job referencing the parent/accepted asset
    let jobId = null;
    try {
      const payload = { parentAssetId: assetId, previewOnly: true };
      const { data: jobRow, error: jobErr } = await supabaseAdmin
        .from("jobs")
        .insert([{
          subject_id: subjectId,
          type: "generate-sheet",
          payload,
          status: "queued",
        }])
        .select()
        .single();

      if (!jobErr && jobRow) {
        jobId = jobRow.id;
      } else if (jobErr) {
        console.warn("accept asset: enqueue job error", jobErr);
      }
    } catch (e) {
      console.warn("accept asset: enqueue job exception", e);
    }

    // 4) Update subject.status AFTER enqueue attempt (reduces race with poll)
    try {
      const newStatus = jobId ? "queued_generation" : "awaiting-approval";
      const { error: subjUpdateErr } = await supabaseAdmin
        .from("subjects")
        .update({ status: newStatus, updated_at: nowIso })
        .eq("id", subjectId);
      if (subjUpdateErr) console.warn("accept asset: failed to update subject status", subjUpdateErr);
    } catch (e) {
      console.warn("accept asset: update subject status exception", e);
    }

    // 5) Return fresh subject row and current assets (assets enriched with signedUrl)
    let freshSubj = null;
    try {
      const { data: s, error: sErr } = await supabaseAdmin
        .from("subjects")
        .select("*")
        .eq("id", subjectId)
        .single();
      if (!sErr && s) freshSubj = s;
      else if (sErr) console.warn("accept asset: fetch fresh subject error", sErr);
    } catch (e) {
      console.warn("accept asset: fetch subject exception", e);
    }

    const assets = await fetchAssetsWithSignedUrls(subjectId);

    if (freshSubj) freshSubj.assets = assets;

    return NextResponse.json({ ok: true, jobId: jobId || null, subject: freshSubj || null, assets });
  } catch (err) {
    console.error("accept asset route error:", err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
