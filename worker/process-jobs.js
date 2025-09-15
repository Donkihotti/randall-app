// worker/process-jobs.js
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { Pool } from 'pg'
import Replicate from 'replicate'
import sharp from 'sharp'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import process from 'process'

/* ---------- Config / env ---------- */
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN
const REPLICATE_MODEL_NAME = process.env.REPLICATE_MODEL_NAME || 'google/nano-banana'
const GENERATED_BUCKET = process.env.SUPABASE_GENERATED_BUCKET || 'generated'
const UPLOAD_BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || 'uploads'

// Postgres connection string (required for pg locking)
const DATABASE_URL = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.SUPABASE_DATABASE_URL

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}
if (!DATABASE_URL) {
  throw new Error('Missing DATABASE_URL (Postgres connection string). Set DATABASE_URL to your Supabase DB connection string.')
}
if (!REPLICATE_API_TOKEN) console.warn('Warning: REPLICATE_API_TOKEN not set — generation will fail.')

const WORKER_ID = `${process.env.HOSTNAME || 'worker'}-${process.pid}-${uuidv4().slice(0, 8)}`

/* ---------- Clients ---------- */
const pgPool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
})

const supabaseAdmin = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const replicate = new Replicate({ auth: REPLICATE_API_TOKEN })

/* ---------- Helpers ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function claimNextJob(workerId) {
  const client = await pgPool.connect()
  try {
    const sql = `
      WITH cte AS (
        SELECT id
        FROM public.jobs
        WHERE status = 'queued'
          AND (available_at IS NULL OR available_at <= now())
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE public.jobs j
      SET status = 'running',
          locked_by = $1,
          locked_at = now(),
          updated_at = now()
      FROM cte
      WHERE j.id = cte.id
      RETURNING j.*;
    `
    const res = await client.query(sql, [workerId])
    if (!res || !res.rows || res.rows.length === 0) return null
    return res.rows[0]
  } finally {
    client.release()
  }
}

function extToMimeFromPath(p) {
  const ext = (path.extname(p) || '').toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'application/octet-stream'
}

async function downloadStorageToBuffer(objectPath, bucketName = UPLOAD_BUCKET) {
  const { data, error } = await supabaseAdmin.storage.from(bucketName).download(objectPath)
  if (error || !data) throw new Error('Failed to download storage object: ' + (error?.message || 'no data'))
  if (data.arrayBuffer) {
    const arr = await data.arrayBuffer()
    return Buffer.from(arr)
  }
  // Node stream fallback
  const chunks = []
  for await (const chunk of data.stream()) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function uploadBufferToStorage(buffer, objectPath, bucket = GENERATED_BUCKET) {
  const { error: upErr } = await supabaseAdmin.storage.from(bucket).upload(objectPath, buffer, {
    contentType: extToMimeFromPath(objectPath),
    upsert: false,
  })
  if (upErr) throw upErr

  const { data: urlData, error: urlErr } = await supabaseAdmin.storage.from(bucket).createSignedUrl(objectPath, 60 * 60)
  if (urlErr) {
    // return object path even if signed url failed
    return { objectPath, object_path: objectPath, url: null }
  }
  return { objectPath, object_path: objectPath, url: (urlData && (urlData.signedUrl || urlData.signedURL)) || null }
}

/** Normalize replicate outputs into array of {type, value} */
async function extractOutputsAsync(out) {
  const results = []
  if (!out) return results
  if (typeof out === 'string') {
    if (out.startsWith('data:')) results.push({ type: 'data', value: out })
    else if (/^https?:\/\//i.test(out)) results.push({ type: 'url', value: out })
    else results.push({ type: 'string', value: out })
    return results
  }
  if (Array.isArray(out)) {
    for (const e of out) results.push(...(await extractOutputsAsync(e)))
    return results
  }
  if (typeof out === 'object') {
    if (out.url) {
      if (typeof out.url === 'function') {
        try {
          const val = out.url()
          const awaited = val instanceof Promise ? await val : val
          results.push(...(await extractOutputsAsync(awaited)))
        } catch (e) {
          console.warn('extractOutputs: out.url() failed', e)
        }
      } else {
        results.push(...(await extractOutputsAsync(out.url)))
      }
    }
    if (out.output) results.push(...(await extractOutputsAsync(out.output)))
    if (out.image) results.push(...(await extractOutputsAsync(out.image)))
    if (out.result) results.push(...(await extractOutputsAsync(out.result)))
    if (out.base64 || out.b64 || out.b64_json) {
      const b64 = out.base64 || out.b64 || out.b64_json
      if (typeof b64 === 'string') results.push({ type: 'base64', value: b64 })
    }
    try {
      const s = JSON.stringify(out)
      const found = s.match(/https?:\/\/[^\s"']+/g)
      if (found) {
        for (const u of Array.from(new Set(found))) results.push({ type: 'url', value: u })
      }
    } catch (e) {}
  }
  return results
}

async function saveExtractedItemToStorage(item, subjectId, idx) {
  if (!item) return null
  const fname = `nb-${subjectId}-${Date.now()}-${idx}.png`
  const objectPath = `${subjectId}/${fname}`

  if (item.type === 'url') {
    const r = await fetch(item.value)
    if (!r.ok) throw new Error(`Failed to fetch ${item.value} status ${r.status}`)
    const arr = new Uint8Array(await r.arrayBuffer())
    const buffer = Buffer.from(arr)
    return await uploadBufferToStorage(buffer, objectPath, GENERATED_BUCKET)
  }

  if (item.type === 'data') {
    const parts = item.value.split(',')
    if (parts.length !== 2) throw new Error('Invalid data URI')
    const b64 = parts[1]
    const buffer = Buffer.from(b64, 'base64')
    return await uploadBufferToStorage(buffer, objectPath, GENERATED_BUCKET)
  }

  if (item.type === 'base64') {
    const buffer = Buffer.from(item.value, 'base64')
    return await uploadBufferToStorage(buffer, objectPath, GENERATED_BUCKET)
  }

  if (item.type === 'string') {
    if (/^https?:\/\//i.test(item.value)) {
      return await saveExtractedItemToStorage({ type: 'url', value: item.value }, subjectId, idx)
    }
    return null
  }

  return null
}

    /* ---------- Helper: update subject pointer for assets ---------- */
    
    /**
     * Update subjects.<fieldName> JSONB with an array of asset IDs and optionally set status.
     * fieldName should be 'sheet_asset_ids' or 'latest_asset_ids' etc.
     *
     * Returns true if update succeeded, false otherwise.
     */
    async function updateSubjectAssetIds(subjectId, assetIds = [], fieldName = 'sheet_asset_ids', newStatus = null) {
      if (!subjectId) return false;
      if (!Array.isArray(assetIds)) assetIds = [];
    
      const client = await pgPool.connect();
      try {
        if (newStatus) {
          const sql = `
            UPDATE public.subjects
            SET ${fieldName} = $1::jsonb,
                status = $2,
                updated_at = now()
            WHERE id = $3
          `;
          await client.query(sql, [JSON.stringify(assetIds), newStatus, subjectId]);
        } else {
          const sql = `
            UPDATE public.subjects
            SET ${fieldName} = $1::jsonb,
                updated_at = now()
            WHERE id = $2
          `;
          await client.query(sql, [JSON.stringify(assetIds), subjectId]);
        }
        return true;
      } catch (e) {
        console.warn('updateSubjectAssetIds failed:', e);
        return false;
      } finally {
        client.release();
      }
    }

    async function createThumbnailFromBuffer(buffer, subjectId, filenameBase = 'thumb', ownerId = null) {
      try {
        console.log(`[worker] createThumbnailFromBuffer: subject=${subjectId} filenameBase=${filenameBase} ownerId=${ownerId}`);
        // If ownerId not provided, try to look it up from subjects table
        let owner_id_val = ownerId;
        if (!owner_id_val) {
          try {
            const { data: subjRow, error: subjErr } = await supabaseAdmin.from('subjects').select('owner_id').eq('id', subjectId).limit(1).single();
            if (subjErr) {
              console.warn('[worker] createThumbnailFromBuffer: could not read subject owner', subjErr);
            } else {
              owner_id_val = subjRow?.owner_id || null;
            }
          } catch (e) {
            console.warn('[worker] createThumbnailFromBuffer: subject lookup failed', e);
          }
        }
    
        if (!owner_id_val) {
          console.warn('[worker] createThumbnailFromBuffer: subject has no owner_id; skipping DB insert to avoid NOT NULL constraint. SubjectId=', subjectId);
          return null;
        }
    
        const thumbBuf = await sharp(buffer)
          .resize(400, 400, { fit: 'cover' })
          .jpeg({ quality: 78 })
          .toBuffer();
    
        const thumbName = `${Date.now()}-${uuidv4().slice(0,8)}-${(filenameBase||'thumb').replace(/\s+/g,'-').toLowerCase()}.jpg`;
        const objectPath = `${subjectId}/thumbnails/${thumbName}`;
    
        const upResult = await uploadBufferToStorage(thumbBuf, objectPath, GENERATED_BUCKET);
        console.log('[worker] createThumbnailFromBuffer: upload result', { objectPath: upResult.object_path || upResult.objectPath, urlPresent: !!upResult.url });
    
        const thumbAsset = {
          subject_id: subjectId,
          owner_id: owner_id_val, // NON-NULL guaranteed above
          type: 'thumbnail',
          bucket: GENERATED_BUCKET,
          object_path: upResult.object_path || upResult.objectPath || objectPath,
          filename: thumbName,
          url: upResult.url || null,
          meta: { derived_from: filenameBase, kind: 'thumbnail' },
          parent_id: null,
          version: 1,
          active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
    
        const { data: inserted, error: insErr } = await supabaseAdmin.from('assets').insert(thumbAsset).select().limit(1).maybeSingle();
        if (insErr) {
          console.warn('[worker] createThumbnailFromBuffer: DB insert error', insErr);
          // cleanup uploaded object to avoid orphan
          try { await supabaseAdmin.storage.from(GENERATED_BUCKET).remove([objectPath]); } catch (e) {}
          throw insErr;
        }
    
        console.log('[worker] createThumbnailFromBuffer: inserted thumb asset id=', inserted?.id);
        return inserted;
      } catch (e) {
        console.warn('[worker] createThumbnailFromBuffer failed', e && (e.message || e));
        return null;
      }
    }    
    
    async function createThumbnailForAssetRow(assetRow, subjectId, ownerId = null) {
      if (!assetRow) {
        console.warn('[worker] createThumbnailForAssetRow: missing assetRow');
        return null;
      }
      let buf = null;
    
      try {
        console.log('[worker] createThumbnailForAssetRow: fetching source for', assetRow.id);
        if (assetRow.object_path) {
          buf = await downloadStorageToBuffer(assetRow.object_path, assetRow.bucket || GENERATED_BUCKET);
        } else if (assetRow.url) {
          const r = await fetch(assetRow.url);
          if (!r.ok) throw new Error('fetch of asset url failed: ' + r.status);
          const arr = new Uint8Array(await r.arrayBuffer());
          buf = Buffer.from(arr);
        }
      } catch (e) {
        console.warn('[worker] createThumbnailForAssetRow: failed to fetch source buffer, skipping thumb', e && (e.message || e));
        return null;
      }
    
      if (!buf) {
        console.warn('[worker] createThumbnailForAssetRow: no buffer obtained');
        return null;
      }
    
      const filenameBase = assetRow.filename || (assetRow.object_path ? assetRow.object_path.split('/').pop() : 'asset');
    
      // pass ownerId through to the creator
      const thumb = await createThumbnailFromBuffer(buf, subjectId, filenameBase, ownerId);
    
      if (thumb) {
        try {
          const { data, error } = await supabaseAdmin.from('assets').update({ parent_id: assetRow.id, updated_at: new Date().toISOString() }).eq('id', thumb.id).select().limit(1).maybeSingle();
          if (error) console.warn('[worker] createThumbnailForAssetRow: failed to set parent_id on thumb asset', error);
          else console.log('[worker] createThumbnailForAssetRow: set parent_id, thumb.id=', thumb.id, 'parent=', assetRow.id);
        } catch (e) {
          console.warn('[worker] createThumbnailForAssetRow: update parent_id exception', e);
        }
      } else {
        console.warn('[worker] createThumbnailForAssetRow: createThumbnailFromBuffer returned null');
      }
    
      return thumb;
    }
    
    async function attachThumbnailToSubject(subjectId, thumbnailAssetId) {
      if (!subjectId || !thumbnailAssetId) {
        console.warn('[worker] attachThumbnailToSubject: missing args', { subjectId, thumbnailAssetId });
        return false;
      }
      try {
        const { data, error } = await supabaseAdmin.from('subjects').update({
          thumbnail_asset_id: thumbnailAssetId,
          updated_at: new Date().toISOString()
        }).eq('id', subjectId).select().limit(1).maybeSingle();
    
        if (error) {
          console.warn('[worker] attachThumbnailToSubject update error', error);
          return false;
        }
        if (!data) {
          console.warn('[worker] attachThumbnailToSubject: update returned no data');
          return false;
        }
        console.log('[worker] attachThumbnailToSubject: updated subject', subjectId, 'thumbnail=', thumbnailAssetId);
        return true;
      } catch (e) {
        console.warn('[worker] attachThumbnailToSubject exception', e);
        return false;
      }
    }
    
    async function attachThumbnailToSavedCollectionIfPresent(subjectRow, thumbnailAssetId) {
      if (!subjectRow || !thumbnailAssetId) return false;
      // 1) try explicit pointer fields the old way
      const collectionId = subjectRow.saved_collection_id || subjectRow.collection_id || null;
      if (collectionId) {
        try {
          const { error } = await supabaseAdmin.from('saved_collections').update({
            thumbnail_asset_id: thumbnailAssetId,
            updated_at: new Date().toISOString()
          }).eq('id', collectionId);
          if (error) {
            console.warn('[worker] attachThumbnailToSavedCollectionIfPresent update error', error);
            return false;
          }
          return true;
        } catch (e) {
          console.warn('[worker] attachThumbnailToSavedCollectionIfPresent exception', e);
          return false;
        }
      }
    
      // 2) fallback: find saved_collections that reference this subject (subject_id)
      if (subjectRow.id) {
        try {
          const { data: cols, error: colsErr } = await supabaseAdmin
            .from('saved_collections')
            .select('id')
            .eq('subject_id', subjectRow.id);
          if (colsErr) {
            console.warn('[worker] fallback query failed', colsErr);
            return false;
          }
          if (!cols || cols.length === 0) {
            // nothing to do
            return false;
          }
          // update all matching collections (usually one)
          const ids = cols.map(c => c.id);
          const { error: updErr } = await supabaseAdmin
            .from('saved_collections')
            .update({ thumbnail_asset_id: thumbnailAssetId, updated_at: new Date().toISOString() })
            .in('id', ids);
          if (updErr) {
            console.warn('[worker] attachThumbnail fallback update error', updErr);
            return false;
          }
          return true;
        } catch (e) {
          console.warn('[worker] attachThumbnailToSavedCollectionIfPresent exception (fallback)', e);
          return false;
        }
      }
    
      return false;
    }

/* ---------- New: saveOutputsAsAssets helper ---------- */

/**
 * savedItems: array of { objectPath, object_path, url }
 * subjectId: uuid
 * prompt: string
 * parentAssetId: uuid | null
 * ownerId: uuid
 *
 * Returns inserted asset rows (array)
 */
async function saveOutputsAsAssets(savedItems, subjectId, prompt = null, parentAssetId = null, ownerId = null) {
    if (!Array.isArray(savedItems) || savedItems.length === 0) return []
  
    ownerId = ownerId || null
  
    // compute next version
    let baseVersion = 0
    try {
      if (parentAssetId) {
        const { data: parentRow, error: parentErr } = await supabaseAdmin.from('assets').select('version').eq('id', parentAssetId).single()
        if (!parentErr && parentRow && parentRow.version) baseVersion = Number(parentRow.version)
      } else {
        const { data: maxRow, error: maxErr } = await supabaseAdmin
          .from('assets')
          .select('version')
          .eq('subject_id', subjectId)
          .order('version', { ascending: false })
          .limit(1)
          .single()
        if (!maxErr && maxRow && maxRow.version) baseVersion = Number(maxRow.version)
      }
    } catch (e) {
      console.warn('saveOutputsAsAssets: failed to compute base version', e)
      baseVersion = baseVersion || 0
    }
  
    // mark previous active assets inactive
    try {
      await supabaseAdmin.from('assets').update({ active: false }).eq('subject_id', subjectId).eq('active', true)
    } catch (e) {
      console.warn('saveOutputsAsAssets: failed to mark previous active assets inactive', e)
    }
  
    const inserted = []
    for (let i = 0; i < savedItems.length; i++) {
      const s = savedItems[i]
      const objectPath = s.object_path || s.objectPath || s.objectpath || s.object || s.url || null
      const filename = path.basename(objectPath || (s.url || `asset-${Date.now()}-${i}.png`))
  
      // Build meta by merging incoming saved meta (if any) with canonical fields
      const incomingMeta = (s.meta && typeof s.meta === 'object') ? { ...s.meta } : {}
      const constructedMeta = {
        model: REPLICATE_MODEL_NAME,
        prompt: prompt || null,
        source: s.source || incomingMeta.source || null,
        // preserve any provided angle/group values if present
        ...(incomingMeta || {}),
      }
      // If this saved item indicates it's part of a sheet, ensure group is 'sheet'
      if (incomingMeta.group === 'sheet' || incomingMeta.angle) {
        constructedMeta.group = 'sheet'
        if (incomingMeta.angle) constructedMeta.angle = incomingMeta.angle
      }
  
      const newAsset = {
        subject_id: subjectId,
        owner_id: ownerId || null,
        type: s.type || 'generated_face',
        bucket: GENERATED_BUCKET,
        object_path: objectPath,
        filename,
        url: s.url || null,
        meta: constructedMeta,
        parent_id: parentAssetId || null,
        version: baseVersion + 1 + i,
        active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
  
      try {
        const { data: ins, error: insErr } = await supabaseAdmin.from('assets').insert(newAsset).select().single()
        if (insErr) {
          console.warn('saveOutputsAsAssets: insert error', insErr)
          continue
        }
        inserted.push(ins)
      } catch (e) {
        console.warn('saveOutputsAsAssets: unexpected insert exception', e)
      }
    }
  
    // If any of the inserted assets are sheet assets, update subjects.sheet_asset_ids to point to them
    try {
      const sheetIds = inserted.filter(a => a && a.meta && a.meta.group === 'sheet').map(a => a.id)
      if (sheetIds.length > 0) {
        // atomically set subject.sheet_asset_ids to the new sheet ids (replace previous)
        const { error: subjErr } = await supabaseAdmin.from('subjects').update({
          sheet_asset_ids: sheetIds,
          status: parentAssetId ? 'awaiting-approval' : 'sheet_generated',
          updated_at: new Date().toISOString()
        }).eq('id', subjectId)
        if (subjErr) {
          console.warn('saveOutputsAsAssets: failed to update subjects.sheet_asset_ids', subjErr)
        }
      } else {
        // update subject.status for non-sheet assets (best-effort)
        try {
          await supabaseAdmin.from('subjects').update({
            status: parentAssetId ? 'awaiting-approval' : 'generated',
            updated_at: new Date().toISOString()
          }).eq('id', subjectId)
        } catch (e) {
          console.warn('saveOutputsAsAssets: failed to update subject status', e)
        }
      }
    } catch (e) {
      console.warn('saveOutputsAsAssets: post-insert subject update failed', e)
    }
  
    return inserted
  }

/* ---------- Job processors ---------- */

async function processPreprocessJob(jobRow) {
  const subjectId = jobRow.subject_id
  console.log(`[${WORKER_ID}] Preprocess job for subject ${subjectId}`)

  const { data: subj, error: subjErr } = await supabaseAdmin.from('subjects').select('*').eq('id', subjectId).single()
  if (subjErr || !subj) throw new Error('Subject not found for preprocess: ' + (subjErr?.message || subjectId))

  const assets = Array.isArray(subj.assets) ? subj.assets.slice() : []
  const faceRefs = subj.face_refs || []
  const bodyRefs = subj.body_refs || []

  async function procRef(ref, typePrefix) {
    if (!ref) return null
    let buffer = null
    const objectPathCandidate = ref.object_path || ref.objectPath || ref.path || null

    if (objectPathCandidate) {
      try {
        buffer = await downloadStorageToBuffer(objectPathCandidate, UPLOAD_BUCKET)
      } catch (e) {
        if (typeof ref.url === 'string' && /^https?:\/\//i.test(ref.url)) {
          try {
            const r = await fetch(ref.url)
            if (!r.ok) throw new Error('Failed to fetch ref url ' + r.status)
            const arr = new Uint8Array(await r.arrayBuffer())
            buffer = Buffer.from(arr)
          } catch (er) {
            console.warn('procRef fetch fallback failed', er)
            return null
          }
        } else {
          console.warn('Could not download ref for preprocess:', ref, e)
          return null
        }
      }
    } else if (typeof ref.url === 'string' && /^https?:\/\//i.test(ref.url)) {
      const r = await fetch(ref.url)
      if (!r.ok) return null
      const arr = new Uint8Array(await r.arrayBuffer())
      buffer = Buffer.from(arr)
    } else {
      return null
    }

    try {
      const thumbBuf = await sharp(buffer).resize(512, 512, { fit: 'cover' }).png().toBuffer()
      const baseName = ref.filename || ref.object_path || ref.path || 'ref'
      const thumbObject = `thumbs/${subjectId}/${typePrefix}-${path.basename(baseName)}-${Date.now()}.png`
      const up = await uploadBufferToStorage(thumbBuf, thumbObject, GENERATED_BUCKET)
      if (up) {
        return { type: typePrefix === 'face' ? 'thumb_face' : 'thumb_body', url: up.url, object_path: up.object_path, origin: ref.url || null, created_at: new Date().toISOString() }
      }
    } catch (e) {
      console.warn('Failed creating thumbnail:', e)
    }
    return null
  }

  for (const f of faceRefs.slice(0, 4)) {
    const t = await procRef(f, 'face')
    if (t) assets.push(t)
  }
  for (const b of bodyRefs.slice(0, 4)) {
    const t = await procRef(b, 'body')
    if (t) assets.push(t)
  }

  const upd = {
    assets,
    status: 'awaiting-approval',
    updated_at: new Date().toISOString(),
  }
  const { error: updErr } = await supabaseAdmin.from('subjects').update(upd).eq('id', subjectId)
  if (updErr) throw updErr

  return { ok: true, assetsAdded: true }
}

/* ---------- NEW: generate-sheet job handler ---------- */
/**
 * processGenerateSheetJob
 * - jobRow.payload expected shape:
 *   { parentAssetId?: string, angles?: string[], previewOnly?: boolean, settings?: {} }
 *
 * Produces sheet_face assets and updates subject.status -> 'sheet_generated'
 */
// Add this function to worker/process-jobs.js (near other processors)

async function processGenerateSheetJob(jobRow) {
  const subjectId = jobRow.subject_id;
  console.log(`[${WORKER_ID}] generate-sheet job for subject ${subjectId} (job=${jobRow.id})`);

  // load subject for owner info and sanity
  const { data: subj, error: subjErr } = await supabaseAdmin.from('subjects').select('*').eq('id', subjectId).single();
  if (subjErr || !subj) throw new Error('Subject not found for generate-sheet: ' + (subjErr?.message || subjectId));

  // find parent/accepted asset id (be tolerant of payload key names)
  const parentAssetId = jobRow.payload?.parentAssetId || jobRow.payload?.accepted_asset_id || null;
  if (!parentAssetId) {
    throw new Error('generate-sheet: missing parentAssetId in job payload');
  }

  // fetch parent asset row
  let parentAsset = null;
  try {
    const { data: pa, error: paErr } = await supabaseAdmin.from('assets').select('*').eq('id', parentAssetId).single();
    if (!paErr && pa) parentAsset = pa;
  } catch (e) {
    console.warn(`[${WORKER_ID}] could not load parent asset ${parentAssetId}:`, e);
  }
  if (!parentAsset) throw new Error('Parent asset not found: ' + parentAssetId);

  // resolve a usable image_input for replicate: prefer asset.url, otherwise signed url from object_path, otherwise data URI
  let sourceUrlOrDataUri = null;
  if (parentAsset.url) {
    sourceUrlOrDataUri = parentAsset.url;
  } else if (parentAsset.object_path) {
    try {
      const { data: signedData, error: signErr } = await supabaseAdmin.storage
        .from(parentAsset.bucket || GENERATED_BUCKET)
        .createSignedUrl(parentAsset.object_path, 60 * 60);
      if (!signErr && signedData?.signedUrl) {
        sourceUrlOrDataUri = signedData.signedUrl;
      }
    } catch (e) {}
  }
  if (!sourceUrlOrDataUri) {
    // fallback to downloading object and converting to data URI
    try {
      const buf = await downloadStorageToBuffer(parentAsset.object_path || parentAsset.objectPath, parentAsset.bucket || GENERATED_BUCKET);
      const mime = extToMimeFromPath(parentAsset.filename || parentAsset.object_path || '') || 'image/png';
      sourceUrlOrDataUri = `data:${mime};base64,${buf.toString('base64')}`;
    } catch (e) {
      console.warn(`[${WORKER_ID}] failed to resolve parent asset data for replicate image_input:`, e);
      throw new Error('Failed to resolve parent asset image_input');
    }
  }

  // Choose angles (4 angles). Allow override from payload.faceAngles.
  const requestedAngles = Array.isArray(jobRow.payload?.faceAngles) && jobRow.payload.faceAngles.length
    ? jobRow.payload.faceAngles
    : ['center', 'left', 'right', '3q-left'];

  // angle -> human text
  const anglePromptMap = {
    center: 'head facing the camera directly (0°)',
    left: 'head turned left (45°)',
    right: 'head turned right (45°)',
    '3q-left': '3/4 left portrait (30° left)',
    '3q-right': '3/4 right portrait (30° right)',
    up: 'head tilted up slightly (15° up)',
    down: 'head tilted down slightly (15° down)'
  };

  const savedAll = []; // will hold saved storage objects (from saveExtractedItemToStorage)
  for (let i = 0; i < requestedAngles.length; i++) {
    const angle = requestedAngles[i];
    const angleText = anglePromptMap[angle] || `head pose: ${angle}`;
    const basePrompt = jobRow.payload?.prompt || subj.base_prompt || subj.description || 'Photorealistic close-up portrait, neutral expression, studio lighting.';
    const prompt = `${basePrompt} Close-up portrait, ${angleText}. Photorealistic, high detail, preserve identity and facial features. Neutral expression.`;

    const inputForReplicate = { prompt };
    // supply image_input as array per model expectation
    inputForReplicate.image_input = [sourceUrlOrDataUri];

    // merge settings if provided
    if (jobRow.payload && jobRow.payload.settings && typeof jobRow.payload.settings === 'object') {
      Object.assign(inputForReplicate, jobRow.payload.settings);
    }

    // call replicate
    let rawOutput;
    try {
      console.log(`[${WORKER_ID}] replicate.run sheet angle=${angle} input keys=${Object.keys(inputForReplicate)}`);
      rawOutput = await replicate.run(REPLICATE_MODEL_NAME, { input: inputForReplicate });
    } catch (e) {
      console.warn(`[${WORKER_ID}] Replicate.run error for angle ${angle}:`, e);
      // record a warning on subject and continue
      try {
        const sWarn = (subj.warnings || []).slice();
        sWarn.push(`Replicate error for angle ${angle}: ${String(e)}`);
        await supabaseAdmin.from('subjects').update({ warnings: sWarn, updated_at: new Date().toISOString() }).eq('id', subjectId);
      } catch (er) {}
      continue;
    }

    // extract outputs
    const extracted = await extractOutputsAsync(rawOutput);
    if (!extracted || extracted.length === 0) {
      console.warn(`[${WORKER_ID}] No outputs from Replicate for angle ${angle}`);
      continue;
    }

    // save each extracted item to storage
    for (let j = 0; j < extracted.length; j++) {
      try {
        const s = await saveExtractedItemToStorage(extracted[j], subjectId, `${i}-${j}`);
        if (s) {
          // attach angle meta for later asset insertion convenience
          s._angle = angle;
          s._prompt = prompt;
          savedAll.push(s);
        }
      } catch (err) {
        console.warn(`[${WORKER_ID}] failed to save extracted item for angle ${angle}:`, err);
      }
    }
  } // end angles loop

  if (savedAll.length === 0) throw new Error('No saved outputs generated for sheet');

  // Persist into assets table (service-role) and mark older assets inactive
  let insertedAssets = [];
  try {
    const parentAssetId = jobRow.payload && jobRow.payload.parentAssetId ? jobRow.payload.parentAssetId : null;

    // Normalize saved items into the shape saveOutputsAsAssets expects and ensure meta includes group/angle/prompt
    const itemsToPersist = savedAll.map((s) => {
      const meta = (s.meta && typeof s.meta === 'object') ? { ...s.meta } : {};
      if (!meta.group) meta.group = 'sheet';
      if (!meta.angle && s._angle) meta.angle = s._angle;
      if (!meta.prompt && s._prompt) meta.prompt = s._prompt;
      return {
        object_path: s.object_path || s.objectPath || s.objectPath || null,
        objectPath: s.object_path || s.objectPath || s.objectPath || null,
        url: s.url || null,
        source: s.source || null,
        meta,
        type: 'sheet_face',
      };
    });

    insertedAssets = await saveOutputsAsAssets(itemsToPersist, subjectId, null, parentAssetId, subj.owner_id);
    console.log(`[${WORKER_ID}] saved ${insertedAssets.length} asset rows for subject ${subjectId}`);
  } catch (e) {
    console.warn('Failed to persist outputs to assets table:', e);
  }

  try {
      const sheetIds = insertedAssets && insertedAssets.length ? insertedAssets.map(a => a.id).filter(Boolean) : [];
      if (sheetIds.length > 0) {
        const desiredStatus = jobRow.payload?.previewOnly ? 'awaiting-approval' : 'sheet_generated';
        // update canonical pointer (best-effort)
        const ok = await updateSubjectAssetIds(subjectId, sheetIds, 'sheet_asset_ids', desiredStatus);
        if (!ok) {
          console.warn(`[${WORKER_ID}] updateSubjectAssetIds(sheet) returned false for subject ${subjectId}`);
        } else {
          console.log(`[${WORKER_ID}] updated subjects.sheet_asset_ids for ${subjectId} ->`, sheetIds);
        }
      } else {
        console.warn(`[${WORKER_ID}] generate-sheet: no sheet asset ids to update for subject ${subjectId}`);
      }
    } catch (e) {
      console.warn('Failed to update subjects.sheet_asset_ids after generate-sheet:', e);
    }

  // Update subject: add face_refs or sheet refs and set status
  try {
    // Build a small face_refs array from first inserted asset if present
    let prevFaceRefs = Array.isArray(subj.face_refs) ? subj.face_refs.slice() : [];
    if (insertedAssets && insertedAssets.length) {
      const a = insertedAssets[0];
      prevFaceRefs.unshift({
        filename: a.filename || a.object_path || a.objectPath || '',
        url: a.url || null,
        object_path: a.object_path || a.objectPath || null,
        generated: true,
        generated_at: new Date().toISOString()
      });
    }
    const newStatus = jobRow.payload?.previewOnly ? 'awaiting-approval' : 'sheet_generated';
    const { error: subjUpdErr } = await supabaseAdmin.from('subjects').update({
      status: newStatus,
      face_refs: prevFaceRefs,
      updated_at: new Date().toISOString()
    }).eq('id', subjectId);
    if (subjUpdErr) console.warn(`[${WORKER_ID}] Failed to update subject after generate-sheet:`, subjUpdErr);
  } catch (e) {
    console.warn(`[${WORKER_ID}] failed updating subject after generate-sheet:`, e);
  }

  // Build result for job result
  const resultSaved = (insertedAssets && insertedAssets.length)
    ? insertedAssets.map(a => ({ assetId: a.id, url: a.url || null, objectPath: a.object_path || a.objectPath || null }))
    : savedAll.map((s, idx) => ({ url: s.url || null, objectPath: s.object_path || s.objectPath || null }));

  return { ok: true, saved: resultSaved, assets: insertedAssets && insertedAssets.length ? insertedAssets : null };
}


/* ---------- generate-face job handler ---------- */

async function processGenerateFaceJob(jobRow) {
  const subjectId = jobRow.subject_id
  console.log(`[${WORKER_ID}] generate-face job for subject ${subjectId}`)

  const { data: subj, error: subjErr } = await supabaseAdmin.from('subjects').select('*').eq('id', subjectId).single()
  if (subjErr || !subj) throw new Error('Subject not found for generate-face: ' + (subjErr?.message || subjectId))

  const rawInputs = (jobRow.payload && jobRow.payload.image_input) || []
  const normalizedInputs = []

  for (const item of rawInputs) {
    if (!item) continue
    let uri = item
    if (typeof item === 'object' && item.url) uri = item.url
    if (typeof uri !== 'string') continue

    if (uri.startsWith('data:') || /^https?:\/\//i.test(uri)) {
      normalizedInputs.push(uri)
      continue
    }
    const candidate = uri.replace(/^\//, '')
    try {
      const { data: signed, error: sErr } = await supabaseAdmin.storage.from(GENERATED_BUCKET).createSignedUrl(candidate, 60 * 60)
      if (!sErr && signed?.signedUrl) {
        normalizedInputs.push(signed.signedUrl)
        continue
      }
    } catch (e) {}
    try {
      const { data: signed2, error: sErr2 } = await supabaseAdmin.storage.from(UPLOAD_BUCKET).createSignedUrl(candidate, 60 * 60)
      if (!sErr2 && signed2?.signedUrl) {
        normalizedInputs.push(signed2.signedUrl)
        continue
      }
    } catch (e) {}
    try {
      const buf = await downloadStorageToBuffer(candidate, UPLOAD_BUCKET)
      const mime = extToMimeFromPath(candidate) || 'image/png'
      normalizedInputs.push(`data:${mime};base64,${buf.toString('base64')}`)
    } catch (e) {
      console.warn('Could not normalize input:', uri, e)
    }
  }

  const input = {}
  if (jobRow.payload && jobRow.payload.prompt) input.prompt = jobRow.payload.prompt
  if (normalizedInputs.length) input.image_input = normalizedInputs
  if (jobRow.payload && jobRow.payload.settings && typeof jobRow.payload.settings === 'object') {
    Object.assign(input, jobRow.payload.settings)
  }
  if (!input.prompt && (!input.image_input || input.image_input.length === 0)) {
    input.prompt = subj.base_prompt || subj.description || 'Photorealistic close-up portrait, neutral expression, studio lighting.'
  }

  let rawOutput
  try {
    console.log(`[${WORKER_ID}] Calling replicate model=${REPLICATE_MODEL_NAME}`)
    rawOutput = await replicate.run(REPLICATE_MODEL_NAME, { input })
  } catch (e) {
    console.error(`[${WORKER_ID}] Replicate.run error:`, e)
    // If replicate returns a known safety error, update subject.status to 'failed' or 'awaiting-approval' as appropriate.
    // For now rethrow to let job retry/backoff handled by markJobFailed.
    throw e
  }

  const extracted = await extractOutputsAsync(rawOutput)
  if (!extracted || extracted.length === 0) throw new Error('No outputs from Replicate')

  const saved = []
  for (let i = 0; i < extracted.length; i++) {
    try {
      const s = await saveExtractedItemToStorage(extracted[i], subjectId, i)
      if (s) saved.push(s)
    } catch (err) {
      console.warn('Failed to save extracted item:', extracted[i], err)
    }
  }
  if (saved.length === 0) throw new Error('Failed to save any outputs')

  // Persist into assets table (service-role) and mark older assets inactive
  let insertedAssets = []
  try {
    const parentAssetId = jobRow.payload && jobRow.payload.parentAssetId ? jobRow.payload.parentAssetId : null
    insertedAssets = await saveOutputsAsAssets(saved, subjectId, input.prompt || null, parentAssetId, subj.owner_id)
    console.log(`[${WORKER_ID}] saved ${insertedAssets.length} asset rows for subject ${subjectId}`)
  } catch (e) {
    console.warn('Failed to persist outputs to assets table:', e)
  }

  if (insertedAssets && insertedAssets.length > 0) {
    const baseAsset = insertedAssets[0];
    console.log('[worker] generate-face: creating thumbnail for baseAsset', baseAsset.id, 'subjectOwner=', subj?.owner_id);
    const thumb = await createThumbnailForAssetRow(baseAsset, subjectId, subj?.owner_id || null);
    console.log('[worker] generate-face: thumbnail result', { thumbId: thumb?.id ?? null });
    if (thumb && thumb.id) {
      const subOk = await attachThumbnailToSubject(subjectId, thumb.id);
      console.log('[worker] generate-face: attachThumbnailToSubject returned', subOk);
      const colOk = await attachThumbnailToSavedCollectionIfPresent(subj, thumb.id);
      console.log('[worker] generate-face: attachThumbnailToSavedCollectionIfPresent returned', colOk);
    } else {
      console.warn('[worker] generate-face: no thumb created for subject', subjectId);
    }
  }

   // --- NEW: update subject.latest_asset_ids canonical pointer (best-effort)
  try {
      if (insertedAssets && insertedAssets.length > 0) {
        const ids = insertedAssets.map(a => a.id).filter(Boolean)
        const desiredStatus = jobRow.payload?.previewOnly ? 'awaiting-approval' : 'generated'
        const ok = await updateSubjectAssetIds(subjectId, ids, 'latest_asset_ids', desiredStatus)
        if (!ok) console.warn(`[${WORKER_ID}] updateSubjectAssetIds(latest) returned false for subject ${subjectId}`)
        else console.log(`[${WORKER_ID}] updated subjects.latest_asset_ids for ${subjectId}`)
      }
    } catch (e) {
      console.warn('Failed to update subjects.latest_asset_ids:', e)
    }

  // update legacy subject JSON fields for backward compatibility (face_refs & assets)
  try {
    const prevAssets = Array.isArray(subj.assets) ? subj.assets.slice() : []
    const addToAssets = saved.map((s) => ({
      type: 'generated_face',
      url: s.url,
      object_path: s.object_path || s.objectPath || null,
      created_at: new Date().toISOString(),
      meta: { model: REPLICATE_MODEL_NAME, prompt: input.prompt || null, source: s.source || null },
    }))
    const newAssets = prevAssets.concat(addToAssets)

    const prevFaceRefs = Array.isArray(subj.face_refs) ? subj.face_refs.slice() : []
    if (saved[0]) {
      prevFaceRefs.unshift({
        filename: path.basename(saved[0].object_path || saved[0].objectPath || saved[0].url || 'gen'),
        url: saved[0].url,
        object_path: saved[0].object_path || saved[0].objectPath || null,
        generated: true,
        generated_at: new Date().toISOString(),
      })
    }

    const { error: updErr } = await supabaseAdmin.from('subjects').update({
      assets: newAssets,
      face_refs: prevFaceRefs,
      status: jobRow.payload?.previewOnly ? 'awaiting-approval' : 'generated',
      updated_at: new Date().toISOString(),
    }).eq('id', subjectId)

    if (updErr) console.warn('Failed to update subject after generate-face (legacy fields):', updErr)
  } catch (e) {
    console.warn('Error updating legacy subject fields after generate-face:', e)
  }

  return { ok: true, saved: insertedAssets.length ? insertedAssets : saved }
}

/* ---------- Job lifecycle helpers ---------- */

async function markJobDone(jobId, result = {}) {
  try {
    await pgPool.query(
      `UPDATE public.jobs SET status = 'done', result = $1::jsonb, finished_at = now(), updated_at = now() WHERE id = $2`,
      [result || {}, jobId]
    )
  } catch (e) {
    console.warn('markJobDone failed:', e)
  }
}

async function markJobFailed(jobId, errorMsg, attempts = 1) {
  try {
    const maxAttempts = 5
    const newAttempts = attempts
    let nextAvailable = null
    let status = 'queued'
    if (newAttempts >= maxAttempts) {
      status = 'failed'
      nextAvailable = null
    } else {
      const backoffSeconds = Math.min(60 * Math.pow(2, Math.min(newAttempts, 6)), 3600)
      nextAvailable = new Date(Date.now() + backoffSeconds * 1000).toISOString()
      status = 'queued'
    }

    await pgPool.query(
      `UPDATE public.jobs
       SET status = $1,
           attempts = COALESCE(attempts, 0) + 1,
           result = jsonb_set(coalesce(result, '{}'::jsonb), '{error}', to_jsonb($2::text)),
           available_at = $3,
           updated_at = now()
       WHERE id = $4`,
      [status, errorMsg, nextAvailable, jobId]
    )
  } catch (e) {
    console.warn('markJobFailed failed:', e)
  }
}

/* ---------- Worker main ---------- */

async function processJob(jobRow) {
  const jobId = jobRow.id
  try {
    console.log(`[${WORKER_ID}] Processing job ${jobId} type=${jobRow.type}`)
    let result
    if (jobRow.type === 'preprocess') {
      result = await processPreprocessJob(jobRow)
    } else if (jobRow.type === 'generate-face') {
      result = await processGenerateFaceJob(jobRow)
    } else if (jobRow.type === 'generate-sheet') {
      result = await processGenerateSheetJob(jobRow)
    } else {
      console.warn('Unknown job type, marking done:', jobRow.type)
      result = { ok: true, info: 'unknown job type - skipped' }
    }
    await markJobDone(jobId, result)
    console.log(`[${WORKER_ID}] Job ${jobId} done`)
  } catch (err) {
    console.error(`[${WORKER_ID}] Job ${jobId} error:`, err && (err.message || err))
    const attempts = (jobRow.attempts || 0) + 1
    await markJobFailed(jobId, String(err?.message || err), attempts)
  }
}

async function pollLoop() {
  console.log(`[${WORKER_ID}] Worker started - polling for jobs...`)
  while (true) {
    try {
      const job = await claimNextJob(WORKER_ID)
      if (!job) {
        await sleep(2000)
        continue
      }
      await processJob(job)
    } catch (err) {
      console.error(`[${WORKER_ID}] Worker loop error:`, err)
      await sleep(3000)
    }
  }
}

/* Graceful shutdown */
process.on('SIGINT', async () => {
  console.log('SIGINT received - shutting down worker...')
  try { await pgPool.end() } catch (e) {}
  process.exit(0)
})
process.on('SIGTERM', async () => {
  console.log('SIGTERM received - shutting down worker...')
  try { await pgPool.end() } catch (e) {}
  process.exit(0)
})

/* Start */
pollLoop().catch((e) => {
  console.error('Fatal worker error:', e)
  process.exit(1)
})