import { NextResponse } from 'next/server'
import { createServerSupabase } from '../../../../../utils/supabase/server'

export async function POST(req) {
  try {
    const body = await req.json()
    const username = (body.username || '').toString().trim()
    const display_name = body.display_name ?? null
    const bio = body.bio ?? null

    if (!username) {
      return NextResponse.json({ error: 'Username is required.' }, { status: 400 })
    }
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      return NextResponse.json({ error: 'Username must be 3-30 chars, letters/numbers/underscore only.' }, { status: 400 })
    }

    const supabase = await createServerSupabase()

    // auth check
    const { data: userData, error: userErr } = await supabase.auth.getUser()
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const user = userData.user

    // fetch existing profile
    const { data: profile, error: pErr } = await supabase
      .from('profiles')
      .select('id, username')
      .eq('id', user.id)
      .maybeSingle()

    if (pErr) {
      console.error('profile fetch error', pErr)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    // if username changed, ensure uniqueness
    if (!profile || profile.username !== username) {
      const { data: existing, error: existingErr } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', username)
        .limit(1)
        .maybeSingle()

      if (existingErr) {
        console.error('username check error', existingErr)
        return NextResponse.json({ error: 'Database error' }, { status: 500 })
      }
      if (existing) {
        return NextResponse.json({ error: 'Username already taken.' }, { status: 409 })
      }
    }

    // perform update (upsert style)
    const updates = {
      username,
      display_name,
      bio,
      updated_at: new Date().toISOString(),
    }

    const { error: updateErr } = await supabase
      .from('profiles')
      .upsert({ id: user.id, ...updates }, { onConflict: 'id', returning: 'minimal' })

    if (updateErr) {
      console.error('profile update error', updateErr)
      return NextResponse.json({ error: updateErr.message || 'Failed to update profile.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('profile update unexpected error', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
