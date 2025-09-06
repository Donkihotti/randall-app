// utils/supabase/server.js
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

/**
 * createServerSupabase()
 * - MUST be async because cookies() is async in some Next versions.
 * - Returns a server-side Supabase client wired to Next cookies via getAll/setAll.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies()

  const cookieAdapter = {
    async getAll() {
      const all = await cookieStore.getAll()
      return (all || []).map((c) => ({ name: c.name, value: c.value }))
    },
    setAll(cookiesToSet = []) {
      if (!Array.isArray(cookiesToSet)) return
      cookiesToSet.forEach(({ name, value, options = {} }) => {
        // try object form first, then signature form; swallow errors but log
        try {
          cookieStore.set({
            name,
            value,
            path: options.path,
            maxAge: options.maxAge,
            httpOnly: options.httpOnly,
            secure: options.secure,
            sameSite: options.sameSite,
            domain: options.domain,
            expires: options.expires,
          })
        } catch (err) {
          try {
            cookieStore.set(name, value, {
              path: options.path,
              maxAge: options.maxAge,
              httpOnly: options.httpOnly,
              secure: options.secure,
              sameSite: options.sameSite,
              domain: options.domain,
              expires: options.expires,
            })
          } catch (err2) {
            // eslint-disable-next-line no-console
            console.warn('cookieStore.set failed:', err2)
          }
        }
      })
    },

    // legacy helpers
    async get(name) {
      const all = await cookieAdapter.getAll()
      const found = all.find((c) => c.name === name)
      return found ? found.value : undefined
    },
    set(name, value, options = {}) {
      cookieAdapter.setAll([{ name, value, options }])
    },
    remove(name, options = {}) {
      cookieAdapter.setAll([{ name, value: '', options: { ...options, expires: new Date(0) } }])
    },
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SUPABASE_KEY =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error(
      'Missing Supabase env vars. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) to .env.local and restart dev.'
    )
  }

  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: cookieAdapter,
  })
}
