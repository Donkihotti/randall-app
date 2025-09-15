// components/SignUpForm.js
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SignUpForm({ redirectTo = '/SignInPage' }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setLoading(true)

    const form = new FormData(e.currentTarget)
    const payload = {
      email: form.get('email'),
      password: form.get('password'),
      username: form.get('username'),
      display_name: form.get('display_name'),
      bio: form.get('bio')
    }

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || 'Sign up failed')
        setLoading(false)
        return
      }

      // success message or redirect depending on response
      if (data?.ok) {
        // If sign-up finished and profile created, navigate to login or private as you prefer
        setMessage(data.message || 'Account created')
        // give user a short moment to read message then redirect:
        setTimeout(() => router.push(redirectTo), 900)
      } else if (data?.message) {
        // For cases like "check your email" (email-confirm required)
        setMessage(data.message)
      } else {
        setMessage('Sign up complete. Please check your email if required.')
      }
    } catch (err) {
      console.error('signup fetch error', err)
      setError('Unexpected error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 520, margin: '1.5rem auto' }} className='text-white'>
      <h2>Create an account</h2>

      {error && <div style={{ color: 'var(--danger, #b00020)', marginBottom: 12 }}>{error}</div>}
      {message && <div style={{ color: 'var(--accent, #064e3b)', marginBottom: 12 }}>{message}</div>}

      <label style={{ display: 'block', marginBottom: 8 }}>
        Email
        <input name="email" type="email" required className='input-default bg-normal-dark py-2 px-3.5 w-full mt-1 rounded-xs'/>
      </label>

      <label style={{ display: 'block', marginBottom: 8 }}>
        Password
        <input name="password" type="password" minLength={6} required className='input-default bg-normal-dark py-2 px-3.5 w-full mt-1 rounded-xs'/>
      </label>

      <label style={{ display: 'block', marginBottom: 8 }}>
        Username
        <input name="username" type="text" required className='input-default bg-normal-dark py-2 px-3.5 w-full mt-1 rounded-xs'/>
        <small>letters, numbers, underscore — 3-30 chars</small>
      </label>

      <label style={{ display: 'block', marginBottom: 8 }}>
        Display name
        <input name="display_name" type="text" className='input-default bg-normal-dark py-2 px-3.5 w-full mt-1 rounded-xs'/>
      </label>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="submit" disabled={loading} className='button-normal-orange w-full py-2'>
          {loading ? 'Creating…' : 'Create account'}
        </button>
      </div>
    </form>
  )
}
