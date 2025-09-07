// app/api/subject/route.js
import { NextResponse } from 'next/server'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { createServerSupabase } from '../../../../utils/supabase/server'// must exist from earlier helper
import { supabaseAdmin } from '../../../../lib/supabaseServer'// service role client

const UPLOAD_BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || 'uploads'
const GENERATED_BUCKET = process.env.SUPABASE_GENERATED_BUCKET || 'generated'

function extToMime(filename) {
  const ext = (path.extname(filename || '') || '').toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'application/octet-stream'
}

/** Upload base64 payload to Supabase Storage using service role.
 *  returns { bucket, path, object_path, filename }
 */
async function uploadB64ToStorage({ b64, filename, bucket = UPLOAD_BUCKET, subjectId, userId }) {
  if (!b64 || !filename) throw new Error('Missing b64 or filename')
  const cleanName = path.basename(filename).replace(/\s+/g, '_')
  const object_path = `${userId || 'anon'}/${subjectId || uuidv4()}/${Date.now()}-${cleanName}`
  const raw = b64.includes(',') ? b64.split(',').pop() : b64
  const buffer = Buffer.from(raw, 'base64')
  const mime = extToMime(cleanName)

  const { error: uploadError } = await supabaseAdmin.storage.from(bucket).upload(object_path, buffer, {
    contentType: mime,
    upsert: false,
  })
  if (uploadError) throw uploadError

  return { bucket, path: object_path, object_path, filename: cleanName }
}

/** Normalize ref input shapes and upload base64 when needed. */
async function normalizeRefItem(item, { subjectId, userId }) {
  if (!item) return null

  // string -> treat as URL or storage path
  if (typeof item === 'string') {
    const s = item.trim()
    if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:')) {
      return { url: s }
    }
    // treat as storage path (object_path relative)
    return { bucket: UPLOAD_BUCKET, path: s, object_path: s, filename: path.basename(s) }
  }

  if (item.url && typeof item.url === 'string') {
    return { url: item.url }
  }

  if (item.bucket && (item.path || item.object_path)) {
    const p = item.path || item.object_path
    return { bucket: item.bucket, path: p, object_path: p, filename: item.filename || path.basename(p) }
  }

  if (item.b64 && item.filename) {
    const uploaded = await uploadB64ToStorage({
      b64: item.b64,
      filename: item.filename,
      bucket: UPLOAD_BUCKET,
      subjectId,
      userId,
    })
    return { bucket: uploaded.bucket, path: uploaded.path, object_path: uploaded.object_path, filename: uploaded.filename }
  }

  // unsupported -> null
  return null
}

export async function POST(req) {
  try {
    // request-bound server supabase client (reads cookies via createServerSupabase helper)
    const supabase = await createServerSupabase()
    const { data: userData, error: userErr } = await supabase.auth.getUser()
    if (userErr) {
      console.warn('auth.getUser returned error:', userErr)
    }
    const user = userData?.user
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    // validate name
    const name = body?.name && String(body.name).trim()
    if (!name) return NextResponse.json({ error: 'Missing required field: name' }, { status: 400 })

    const isDraft = !!body.draft

    if (!isDraft) {
      const hasRefs =
        (Array.isArray(body.faceRefs) && body.faceRefs.length > 0) ||
        (Array.isArray(body.bodyRefs) && body.bodyRefs.length > 0)
      if (!hasRefs) {
        return NextResponse.json({ error: 'Please provide at least one faceRef or bodyRef' }, { status: 400 })
      }
    }

    // provisional id for uploads (useful for object paths if client sends base64)
    const provisionalId = `sub_${Date.now()}`

    // normalize refs (upload b64 via service role if provided)
    const storedFaceRefs = []
    const storedBodyRefs = []

    if (Array.isArray(body.faceRefs)) {
      for (const f of body.faceRefs) {
        try {
          const n = await normalizeRefItem(f, { subjectId: provisionalId, userId: user.id })
          if (n) storedFaceRefs.push(n)
        } catch (e) {
          console.warn('normalize face ref failed', e)
        }
      }
    }
    if (Array.isArray(body.bodyRefs)) {
      for (const b of body.bodyRefs) {
        try {
          const n = await normalizeRefItem(b, { subjectId: provisionalId, userId: user.id })
          if (n) storedBodyRefs.push(n)
        } catch (e) {
          console.warn('normalize body ref failed', e)
        }
      }
    }

    // insert DB row using service role client (supabaseAdmin)
    const toInsert = {
      owner_id: user.id,
      name,
      description: body.description || '',
      brand: body.brand || null,
      consent_confirmed: !!body.consentConfirmed,
      base_prompt: body.basePrompt || '',
      status: isDraft ? 'draft' : 'queued',
      face_refs: storedFaceRefs,
      body_refs: storedBodyRefs,
      assets: body.assets || [],
      warnings: [],
      metadata: body.metadata || {},
    }

    const { data: inserted, error: insertErr } = await supabaseAdmin.from('subjects').insert(toInsert).select().single()

    if (insertErr) {
      console.error('insert subject error:', insertErr)
      return NextResponse.json({ error: insertErr.message || 'Insert failed' }, { status: 500 })
    }

    // enqueue preprocess job if not draft
    let job = null
    if (!isDraft) {
      const jobRow = {
        subject_id: inserted.id,
        type: 'preprocess',
        payload: {},
        status: 'queued',
      }
      const { data: jobData, error: jobErr } = await supabaseAdmin.from('jobs').insert(jobRow).select().single()
      if (jobErr) {
        console.warn('enqueue preprocess job failed:', jobErr)
      } else {
        job = jobData
      }
    }

    return NextResponse.json({
      ok: true,
      subjectId: inserted?.id || null,
      subject: inserted,
      job,
    })
  } catch (err) {
    console.error('POST /api/subject error:', err)
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 })
  }
}

  export async function GET(req) { 
    const supabase = await createServerSupabase()
    const { data: userData, error: userErr } = await supabase.auth.getUser()
    if (userErr) {
      console.warn('auth.getUser returned error:', userErr)
    }
    const user = userData?.user
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from("subjects")
      .select("*")
      .eq("owner_id", user.id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ subjects: data }, { status: 200 });
  }

  async function getImageUrl(path) {
    const { data, error } = await supabase.storage
      .from("generated") // bucket name
      .createSignedUrl(path, 60); // valid for 60 seconds
  
    if (error) {
      console.error(error);
      return "";
    }
  
    return data.signedUrl;
  }