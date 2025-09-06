// src/app/api/subject/[id]/status/route.js
import { NextResponse } from 'next/server'
import { createServerSupabase } from '../../../../../../utils/supabase/server' // request-bound helper (awaits cookies)
import { supabaseAdmin } from '../../../../../../lib/supabaseServer' // service-role admin client

const UPLOAD_BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || 'uploads'
const GENERATED_BUCKET = process.env.SUPABASE_GENERATED_BUCKET || 'generated'
const SIGNED_URL_TTL = Number(process.env.SIGNED_URL_TTL_SECONDS || 1200)

async function makeSignedUrl(bucket, objectPath, ttl = SIGNED_URL_TTL) {
  if (!bucket || !objectPath) return null
  try {
    const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(objectPath, ttl)
    if (error) {
      console.warn('createSignedUrl error', { bucket, objectPath, error })
      return null
    }
    return data?.signedUrl || null
  } catch (e) {
    console.warn('createSignedUrl threw', e)
    return null
  }
}

/**
 * Accepts many possible ref shapes and returns item augmented with `signedUrl` if applicable.
 * Supports: { url }, { bucket, path }, { object_path }, plain string path.
 */
async function enrichRefItem(item) {
  if (!item) return null
  // if already an object with url (external/public)
  if (item.url && typeof item.url === 'string') {
    return { ...item, signedUrl: item.url }
  }

  // bucket + path (common)
  if (item.bucket && (item.path || item.object_path)) {
    const p = item.path || item.object_path
    const signed = await makeSignedUrl(item.bucket, p)
    return { ...item, signedUrl: signed }
  }

  // object_path only (assume generated bucket)
  if (item.object_path) {
    const signed = await makeSignedUrl(GENERATED_BUCKET, item.object_path)
    return { ...item, signedUrl: signed }
  }

  // path only (try upload then generated)
  if (item.path) {
    let signed = await makeSignedUrl(UPLOAD_BUCKET, item.path)
    if (!signed) signed = await makeSignedUrl(GENERATED_BUCKET, item.path)
    return { ...item, signedUrl: signed }
  }

  // plain string stored directly in DB -> treat as objectPath candidate
  if (typeof item === 'string') {
    const s = item.replace(/^\//, '')
    let signed = await makeSignedUrl(GENERATED_BUCKET, s)
    if (!signed) signed = await makeSignedUrl(UPLOAD_BUCKET, s)
    return { raw: item, signedUrl: signed || item }
  }

  // fallback, return as-is
  return { ...item }
}

export async function GET(req, { params }) {
  try {
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'Missing subject id' }, { status: 400 })

    // request-bound supabase to read the cookie session
    const supabase = await createServerSupabase()
    const { data: userData, error: userErr } = await supabase.auth.getUser()
    if (userErr) console.error('auth.getUser error:', userErr)
    const user = userData?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // fetch subject with service role (so we get full row regardless of RLS)
    const { data: subjRow, error: subjErr } = await supabaseAdmin.from('subjects').select('*').eq('id', id).single()
    if (subjErr || !subjRow) {
      console.error('subject fetch error:', subjErr)
      return NextResponse.json({ error: 'Subject not found' }, { status: 404 })
    }

    // enforce owner check server-side
    if (String(subjRow.owner_id) !== String(user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // normalize arrays and enrich with signed URLs
    const faceRefs = Array.isArray(subjRow.face_refs) ? subjRow.face_refs : []
    const bodyRefs = Array.isArray(subjRow.body_refs) ? subjRow.body_refs : []
    const assets = Array.isArray(subjRow.assets) ? subjRow.assets : []

    const [enrichedFaceRefs, enrichedBodyRefs, enrichedAssets] = await Promise.all([
      Promise.all(faceRefs.map(enrichRefItem)),
      Promise.all(bodyRefs.map(enrichRefItem)),
      Promise.all(assets.map(enrichRefItem)),
    ])

    const subject = { ...subjRow, face_refs: enrichedFaceRefs, body_refs: enrichedBodyRefs, assets: enrichedAssets }
    return NextResponse.json({ subject })
  } catch (err) {
    console.error('GET /api/subject/:id/status error:', err)
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}
