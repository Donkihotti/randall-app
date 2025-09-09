// src/app/api/subject/[id]/generate-face/route.js
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../../lib/supabaseServer"; // keep your existing path
// NOTE: this route intentionally does NOT call Replicate directly.
// The worker will pick up the generated job and perform the actual generation.

/**
 * POST /api/subject/:id/generate-face
 * Body:
 *  { previewOnly?: boolean, prompt?: string, image_input?: string[], settings?: object, parentAssetId?: uuid }
 *
 * Behavior:
 *  - Validates subject exists.
 *  - Enqueues a job in `jobs` table with type = 'generate-face' and payload containing the body.
 *  - Returns { ok: true, jobId } on success.
 *
 * Important: this route must run with service role privileges (supabaseAdmin).
 */

export async function POST(req, context) {
  try {
    // Next 13+ dynamic route params may be a Promise; await if needed.
    const params = context?.params;
    const resolvedParams = params && typeof params.then === "function" ? await params : params;
    const { id } = resolvedParams || {};

    if (!id) {
      return NextResponse.json({ error: "Missing subject id" }, { status: 400 });
    }

    // parse body defensively
    const body = await req.json().catch(() => ({}));
    const previewOnly = !!body?.previewOnly;

    // verify subject exists (service role)
    const { data: subj, error: subjErr } = await supabaseAdmin
      .from("subjects")
      .select("id, owner_id, status")
      .eq("id", id)
      .single();

    if (subjErr || !subj) {
      console.warn("generate-face route: subject not found", subjErr);
      return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    }

    // build the payload the worker expects (keep it minimal & explicit)
    const jobPayload = {
      prompt: body?.prompt ?? null,
      settings: body?.settings ?? null,
      image_input: Array.isArray(body?.image_input) ? body.image_input : (body?.image_input ? [body.image_input] : []),
      previewOnly: previewOnly,
      parentAssetId: body?.parentAssetId ?? null,
    };

    // enqueue job for worker (service-role)
    let jobRow = null;
    try {
      const insert = await supabaseAdmin
        .from("jobs")
        .insert([
          {
            subject_id: id,
            type: "generate-face",
            payload: jobPayload,
            status: "queued",
          },
        ])
        .select()
        .single();

      if (insert.error) {
        console.warn("generate-face route: enqueue job error", insert.error);
        // bubble up error to client
        return NextResponse.json({ error: "Failed to enqueue generation job" }, { status: 500 });
      }
      jobRow = insert.data || insert;
    } catch (e) {
      console.error("generate-face route: enqueue exception", e);
      return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
    }

    // Optionally, return the fresh subject (light) for client reconciliation
    const { data: freshSubj, error: freshErr } = await supabaseAdmin
      .from("subjects")
      .select("*")
      .eq("id", id)
      .single();

    if (freshErr) {
      console.warn("generate-face route: failed to fetch fresh subject", freshErr);
    }

    return NextResponse.json({
      ok: true,
      jobId: jobRow?.id || null,
      subjectId: id,
      subject: freshSubj || subj,
    });
  } catch (err) {
    console.error("/api/subject/:id/generate-face error:", err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
