'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ButtonOrange from '../buttons/ButtonOrange'

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
    <>
    <span>Account details</span>
    <form onSubmit={handleSubmit} className='mt-22 bg-normal px-3.5 py-3.5 rounded-xs text-white flex flex-col'>
      {error && <div style={{ color: '#b00020' }}>{error}</div>}
      {success && <div style={{ color: '#064e3b' }}>{success}</div>}
      <div className='flex flex-col gap-y-4'>
        <div className='flex flex-col gap-y-2'>
          <label className='text-lighter font-semibold'>
            Username
          </label>
            <input className='input-default bg-normal-dark px-2 py-1 rounded-xs w-52' value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>

      <div className='flex flex-col gap-y-2'>
        <label className='text-lighter font-semibold'>
          Display name
        </label>    
            <input className='input-default bg-normal-dark px-2 py-1 rounded-xs w-52' value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </div>
        <label className='text-lighter font-semibold'>
          Bio
        </label>  
          <textarea className='textarea-default bg-normal-dark w-96' value={bio} onChange={(e) => setBio(e.target.value)} rows={4} />
      </div>
      <div className='mt-5'>
        <ButtonOrange type="submit" disabled={loading}>{loading ? 'Saving…' : 'Save changes'}</ButtonOrange>
        <button type="button" onClick={() => {
          setUsername(initialProfile.username || '')
          setDisplayName(initialProfile.display_name || '')
          setBio(initialProfile.bio || '')
          setError(null); setSuccess(null)
        }}>Reset</button>
      </div>
    </form>
    </> 
  )
}
