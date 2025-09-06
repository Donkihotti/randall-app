import { createServerSupabase } from '../../../utils/supabase/server'

export async function logout() {
  'use server'
  const supabase = await createServerSupabase()
  await supabase.auth.signOut()
  // returning or redirecting from a server action is optional;
  // you can redirect in the UI after the action runs.
}
