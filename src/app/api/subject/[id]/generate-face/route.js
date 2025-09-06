// src/app/api/subject/[id]/generate-face/route.js
import { NextResponse } from 'next/server'
import { createServerSupabase } from '../../../../../../utils/supabase/server'

export async function POST(req, { params }) {
  try {
    const supabase = await createServerSupabase()

    try {
      const cookieHeader = req.headers.get('cookie')
      console.log('[generate-face] incoming Cookie header:', cookieHeader ? '[present]' : '[none]')
    } catch (e) { /** ignore */ }

    const { data: userData, error: userErr } = await supabase.auth.getUser()
    if (userErr) console.warn('[generate-face] auth.getUser returned error:', userErr)
    const user = userData?.user
    if (!user) {
      console.warn('[generate-face] Not authenticated (no user)')
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const userId = user.id
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'Missing subject id' }, { status: 400 })

    // ownership check (request-bound client obeys RLS)
    const { data: subject, error: subjErr } = await supabase
      .from('subjects')
      .select('id, owner_id, name, base_prompt, assets, status')
      .eq('id', id)
      .single()

    if (subjErr || !subject) {
      console.error('[generate-face] subject lookup error:', subjErr)
      return NextResponse.json({ error: 'Subject not found' }, { status: 404 })
    }
    if (String(subject.owner_id) !== String(userId)) {
      console.warn('[generate-face] Forbidden: user', userId, 'is not owner of subject', id)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const prompt = typeof body?.prompt === 'string' ? body.prompt : subject.base_prompt || ''
    const image_input = Array.isArray(body?.image_input) ? body.image_input : []
    const settings = body?.settings ?? {}
    const previewOnly = !!body?.previewOnly

    if (typeof prompt === 'string' && prompt.length > 8000) {
      return NextResponse.json({ error: 'Prompt too long' }, { status: 400 })
    }
    if (image_input.length > 8) {
      return NextResponse.json({ error: 'Too many image inputs (max 8)' }, { status: 400 })
    }

    // create job row (request-bound client obeys RLS)
    const payload = { prompt, image_input, settings, previewOnly }
    const { data: jobData, error: jobErr } = await supabase
      .from('jobs')
      .insert([
        {
          subject_id: id,
          type: 'generate-face',
          payload,
          status: 'queued',
        },
      ])
      .select()
      .single()

    if (jobErr) {
      console.error('[generate-face] failed to insert job:', jobErr)
      return NextResponse.json({ error: 'Failed to enqueue job' }, { status: 500 })
    }

    // fetch the subject row again to return to client (helps client show immediate state)
    const { data: freshSubject, error: freshErr } = await supabase
      .from('subjects')
      .select('id, owner_id, name, base_prompt, assets, status')
      .eq('id', id)
      .single()

    if (freshErr) {
      console.warn('[generate-face] could not fetch subject after enqueue:', freshErr)
    }

    console.log('[generate-face] enqueued job', jobData?.id, 'for subject', id)

    return NextResponse.json({
      ok: true,
      jobId: jobData?.id || null,
      subject: freshSubject || subject || null,
    })
  } catch (err) {
    console.error('[generate-face] route error:', err)
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}
