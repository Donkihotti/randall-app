import SettingsForm from '../components/user/SettingsForm'
import { requireUser } from '../../../lib/auth/requireUser'// returns user or redirects
import PageLayout from '../components/PageLayout/PageLayout'

export default async function SettingsPage() {
  const user = await requireUser('/SignInPage') // will redirect to /login if not signed-in

  const supabase = await import('../../../utils/supabase/server').then(m => m.createServerSupabase()).then(p => p) // safe import
  // or simply: const supabase = await createServerSupabase() if you exported directly

  // fetch profile row
  const { data: profileData, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, bio, created_at, updated_at')
    .eq('id', user.id)
    .maybeSingle()

  // If no profile exists, you may want to initialize it (optional)
  // For now we'll let the form handle missing profile gracefully.
  const profile = profileData ?? { id: user.id, username: '', display_name: '', bio: '' }

  return (
    <PageLayout style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
      <h1 className='text-header-2'>Settings</h1>
      <p className='text-medium'>Manage your profile and account details.</p>

      <SettingsForm initialProfile={profile} />
    </PageLayout>
  )
}
