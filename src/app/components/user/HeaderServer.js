import Link from 'next/link'
import { createServerSupabase } from '../../../../utils/supabase/server'

export default async function HeaderServer() {
  const supabase = await createServerSupabase()
  const { data } = await supabase.auth.getUser()
  const user = data?.user

  let username = null
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .maybeSingle()
    username = profile?.username ?? null
  }

  return (
    <header style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12 }}>
      <Link href="/">Home</Link>
      <Link href="/settings">Settings</Link>
      {user ? <div>Signed in as <strong>{username ?? user.email}</strong></div> : <Link href="/login">Sign in</Link>}
    </header>
  )
}