'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SignInForm({ redirectTo = '/private' }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const form = new FormData(e.currentTarget)
    const payload = {
      email: form.get('email'),
      password: form.get('password'),
    }

    try {
      const res = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data?.error || 'Sign in failed')
        setLoading(false)
        return
      }

      // success: cookies are set server-side; navigate to the private area.
      router.push(redirectTo)
    } catch (err) {
      console.error('signin fetch error', err)
      setError('Unexpected error. Try again.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 420, margin: '1.5rem auto' }}>
      <h2>Sign in</h2>

      {error && <div style={{ color: 'var(--danger, #b00020)', marginBottom: 12 }}>{error}</div>}

      <label style={{ display: 'block', marginBottom: 8 }}>
        Email
        <input name="email" type="email" required />
      </label>

      <label style={{ display: 'block', marginBottom: 8 }}>
        Password
        <input name="password" type="password" required />
      </label>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </form>
  )
}
