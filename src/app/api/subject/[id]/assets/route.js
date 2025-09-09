// src/app/api/subject/[id]/assets/route.js
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../../lib/supabaseServer";

/**
 * GET /api/subject/:id/assets?group=sheet|latest|all
 * Returns ordered asset rows (minimal fields) and ensures signedUrl present when possible.
 */
export async function GET(req, { params }) {
  try {
    // Next.js dynamic params are possibly a promise -> await
    const resolvedParams = params && typeof params.then === "function" ? await params : params;
    const { id } = resolvedParams || {};
    if (!id) return NextResponse.json({ error: "Missing subject id" }, { status: 400 });

    const url = new URL(req.url);
    const group = (url.searchParams.get("group") || "all").toLowerCase(); // sheet, latest, all

    // Fetch subject to get canonical pointers
    const { data: subj, error: subjErr } = await supabaseAdmin
      .from("subjects")
      .select("id, sheet_asset_ids, latest_asset_ids")
      .eq("id", id)
      .single();

    if (subjErr || !subj) {
      return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    }

    // determine asset ids to return (if per-group pointer exists)
    let ids = null;
    if (group === "sheet" && Array.isArray(subj.sheet_asset_ids) && subj.sheet_asset_ids.length) {
      ids = subj.sheet_asset_ids;
    } else if (group === "latest" && Array.isArray(subj.latest_asset_ids) && subj.latest_asset_ids.length) {
      ids = subj.latest_asset_ids;
    }

    let assets = [];
    if (Array.isArray(ids) && ids.length > 0) {
      // fetch rows for these ids
      const { data: rows, error: rowsErr } = await supabaseAdmin
        .from("assets")
        .select("*")
        .in("id", ids);

      if (rowsErr) {
        console.warn("GET /assets: failed to fetch asset rows", rowsErr);
        return NextResponse.json({ error: "Failed to fetch assets" }, { status: 500 });
      }

      // map rows by id for ordering
      const map = new Map();
      for (const r of rows) {
        map.set(r.id, r);
      }
      // return in requested order
      for (const aid of ids) {
        const r = map.get(aid);
        if (r) assets.push(r);
      }
    } else {
      // fallback: return all assets for subject
      const { data: rowsAll, error: rowsAllErr } = await supabaseAdmin
        .from("assets")
        .select("*")
        .eq("subject_id", id)
        .order("created_at", { ascending: false });
      if (rowsAllErr) {
        console.warn("GET /assets: failed to fetch all assets", rowsAllErr);
        return NextResponse.json({ error: "Failed to fetch assets" }, { status: 500 });
      }
      assets = rowsAll || [];
    }

    // Ensure each asset has a usable URL (signedUrl or url)
    const out = [];
    for (const a of assets) {
      const urlCandidate = a.signedUrl || a.url || null;
      let signed = urlCandidate;
      if (!signed && a.object_path && a.bucket) {
        try {
          const { data: signedData, error: signedErr } = await supabaseAdmin
            .storage
            .from(a.bucket)
            .createSignedUrl(a.object_path, 60 * 60 /* 1h */);
          if (!signedErr && signedData?.signedUrl) signed = signedData.signedUrl;
        } catch (e) {
          console.warn("createSignedUrl failed for", a.object_path, e);
        }
      }
      out.push({
        id: a.id,
        subject_id: a.subject_id,
        type: a.type,
        object_path: a.object_path,
        bucket: a.bucket,
        filename: a.filename,
        url: a.url || null,
        signedUrl: signed || null,
        meta: a.meta || {},
        parent_id: a.parent_id || null,
        version: a.version || null,
        created_at: a.created_at || null,
        updated_at: a.updated_at || null,
      });
    }

    return NextResponse.json({ ok: true, assets: out });
  } catch (err) {
    console.error("GET /api/subject/:id/assets error:", err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
