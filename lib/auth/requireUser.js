import { redirect } from 'next/navigation'
import { createServerSupabase } from '../../utils/supabase/server'

/** USAGE IN SERVER PAGE
 import { requireUser } from '@/lib/auth/requireUser'

export default async function PrivatePage() {
  const user = await requireUser('/SignInPage')
  return <div>Welcome, {user.email}</div>
}
 */

export async function requireUser(redirectTo = '/SignInPage') {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) {
    redirect(redirectTo)
  }
  return data.user
}
