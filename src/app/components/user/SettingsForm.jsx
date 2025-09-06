'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SettingsForm({ initialProfile }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  const [username, setUsername] = useState(initialProfile.username || '')
  const [displayName, setDisplayName] = useState(initialProfile.display_name || '')
  const [bio, setBio] = useState(initialProfile.bio || '')

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)

    // basic client validation
    if (!username || !/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      setError('Username must be 3-30 chars and may contain letters, numbers, and underscores.')
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/profile/update', {
        method: 'POST',
        credentials: 'same-origin', // send cookies
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          display_name: displayName.trim() || null,
          bio: bio.trim() || null,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || 'Failed to update profile.')
        setLoading(false)
        return
      }

      setSuccess('Profile updated.')
      // refresh server props / page
      router.refresh()
    } catch (err) {
      console.error('profile update error', err)
      setError('Unexpected error. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }} className='text-black'>
      {error && <div style={{ color: '#b00020' }}>{error}</div>}
      {success && <div style={{ color: '#064e3b' }}>{success}</div>}

      <label>
        Username
        <input value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>

      <label>
        Display name
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>

      <label>
        Bio
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={4} />
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={loading}>{loading ? 'Saving…' : 'Save changes'}</button>
        <button type="button" onClick={() => {
          setUsername(initialProfile.username || '')
          setDisplayName(initialProfile.display_name || '')
          setBio(initialProfile.bio || '')
          setError(null); setSuccess(null)
        }}>Reset</button>
      </div>
    </form>
  )
}
