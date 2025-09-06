'use client'

import { useRouter } from 'next/navigation'
import { createBrowserSupabase } from '../../../../utils/supabase/client'

export default function LogoutButton() {
  const supabase = createBrowserSupabase()
  const router = useRouter()

  async function handleLogout() {
    const { error } = await supabase.auth.signOut()
    if (error) {
      console.error('Sign out error:', error)
      alert(error.message)
      return
    }
    // Optional: navigate to public page after logout
    router.push('/login')
  }

  return (
    <button onClick={handleLogout} type="button">
      Log out
    </button>
  )
}
