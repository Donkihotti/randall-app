import { NextResponse } from 'next/server'
import { createServerSupabase } from '../../../../../utils/supabase/server'

export async function POST(req) {
  try {
    const body = await req.json()
    const email = (body.email || '').toString().trim().toLowerCase()
    const password = (body.password || '').toString()

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })
    }

    // create a server supabase client wired to Next cookies
    const supabase = await createServerSupabase()

    // sign in with password
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      // handle common cases (invalid creds, unconfirmed email, etc.)
      // do not expose internal details
      console.error('signIn error', error)
      return NextResponse.json({ error: error.message || 'Invalid credentials.' }, { status: 401 })
    }

    // data.session / data.user may exist if sign-in succeeded
    // The server client should have set session cookies via the cookie adapter automatically.
    // Do NOT echo tokens back to the client — return a simple success message.
    return NextResponse.json({ ok: true, message: 'Signed in successfully.' })
  } catch (err) {
    console.error('signin route unexpected error', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
