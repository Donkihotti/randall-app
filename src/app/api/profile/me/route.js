import { NextResponse } from 'next/server'
import { createServerSupabase } from '../../../../../utils/supabase/server'

export async function GET(req) {
  try {
    const supabase = await createServerSupabase()
    const { data: userData, error: userErr } = await supabase.auth.getUser()

    if (userErr || !userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = userData.user

    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('id, username, display_name, bio')
      .eq('id', user.id)
      .maybeSingle()

    if (profileErr) {
      console.error('profile fetch error', profileErr)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, profile })
  } catch (err) {
    console.error('profile me route unexpected error', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
