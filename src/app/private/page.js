// app/private/page.js (server component)
import { redirect } from 'next/navigation'
import { logout } from '../logout/actions'
import { createServerSupabase } from '../../../utils/supabase/server'

export default async function PrivatePage() {
  const supabase = await createServerSupabase()
  const { data } = await supabase.auth.getUser()
  if (!data?.user) redirect('/SignInPage')

  return (
    <>
      <p>Hello {data.user.email}</p>
      <form action={logout} method="post">
        <button type="submit">Log out</button>
      </form>
    </>
  )
}