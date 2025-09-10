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
    <PageLayout>
        <div className='flex flex-col w-full h-full items-center justify-center'>
        <h1 className='text-medium'>Settings</h1>
        <p className='text-small'>Manage your profile and account details.</p>
        <span className='text-small text-white'>Account Details</span>
      <SettingsForm initialProfile={profile} />
        </div>
    </PageLayout>
  )
}
