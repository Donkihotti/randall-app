import { NextResponse } from 'next/server'
import { createServerSupabase } from '../../../../../utils/supabase/server'

export async function POST(req) {
  try {
    const body = await req.json()
    const email = (body.email || '').toString().trim().toLowerCase()
    const password = (body.password || '').toString()
    const username = (body.username || '').toString().trim()
    const display_name = (body.display_name || '').toString().trim() || null
    const bio = (body.bio || '').toString().trim() || null

    if (!email || !password || !username) {
      return NextResponse.json({ error: 'Email, password and username are required.' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be >= 6 characters.' }, { status: 400 })
    }
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      return NextResponse.json({ error: 'Username must be 3-30 chars, letters/numbers/underscore only.' }, { status: 400 })
    }

    // IMPORTANT: await the server helper so cookies() is awaited internally and the adapter is installed
    const supabase = await createServerSupabase()

    // Check username uniqueness
    const { data: existing, error: existingErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', username)
      .limit(1)
      .maybeSingle()

    if (existingErr) {
      console.error('profiles select error', existingErr)
      return NextResponse.json({ error: 'Database error checking username.' }, { status: 500 })
    }
    if (existing) {
      return NextResponse.json({ error: 'Username is already taken.' }, { status: 409 })
    }

    // Create auth user
    const { data: signData, error: signError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // optional: redirect after confirmation
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/welcome`
      }
    })

    if (signError) {
      console.error('supabase signUp error', signError)
      return NextResponse.json({ error: signError.message }, { status: 400 })
    }

    // If your project requires email confirmation, signData.user may be null until confirmation.
    const user = signData?.user ?? null

    if (!user) {
      return NextResponse.json({
        ok: true,
        message: 'Sign-up initiated — check your email to confirm your account before signing in.'
      })
    }

    // Insert profile row
    const profileRow = {
      id: user.id,
      username,
      display_name,
      bio
    }

    const { error: insertErr } = await supabase.from('profiles').insert([profileRow])

    if (insertErr) {
      console.error('profile insert error', insertErr)
      return NextResponse.json({ error: insertErr.message || 'Failed to create profile.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, message: 'Account created. You can now sign in.' })
  } catch (err) {
    console.error('signup route unexpected error', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
