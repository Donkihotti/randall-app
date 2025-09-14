'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

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
    <form onSubmit={handleSubmit} style={{ margin: '1.5rem auto' }} className='text-white w-2/3'>

      {error && <div style={{ color: 'var(--danger, #b00020)', marginBottom: 12 }}>{error}</div>}

      <label className='block mt-8 text-small font-semibold'>
        Email
      </label>
        <input 
        name="email" 
        type="email" 
        required 
        placeholder='Email'
        className='input-default bg-normal-dark py-2 px-3.5 w-full mt-1 rounded-xs'/>

      <label className='font-semibold text-small block mt-7'>
        Password
      </label>
        <input 
        name="password" 
        type="password" 
        required 
        placeholder='Password'
        className='input-default bg-normal-dark py-2 px-3.5 w-full rounded-xs mt-1'
        />
        <Link href={'/'} className='text-small text-lighter mt-2 hover:underline'>Forgot your password?</Link>

      <div className='mt-8'>
        <button className='button-normal-orange w-full py-2' type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </form>
  )
}
