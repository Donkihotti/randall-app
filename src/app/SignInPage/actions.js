
import { createServerSupabase } from '../../../utils/supabase/server'

export async function signup(formData) {
  'use server'
  const email = formData.get('email')
  const password = formData.get('password')

  const supabase = createServerSupabase()
  const { error } = await supabase.auth.signUp({ email, password })

  if (error) {
    // throw; the page can catch or show it (keep it simple here)
    throw new Error(error.message)
  }
  // optionally return something (e.g., a redirect url)
  return 
}

export async function login(formData) {
  'use server'
  const email = formData.get('email')
  const password = formData.get('password')
  
  const supabase = createServerSupabase()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    throw new Error(error.message)
  }

  return
}
