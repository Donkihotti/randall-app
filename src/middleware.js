// middleware.js
import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * cookie adapter for middleware (Edge runtime): uses request.headers and NextResponse
 * - getAll() reads cookie header from req
 * - setAll() writes Set-Cookie headers to the response
 */
function parseCookieHeader(header) {
  if (!header) return []
  return header
    .split(';')
    .map((pair) => {
      const idx = pair.indexOf('=')
      if (idx === -1) return null
      const name = pair.slice(0, idx).trim()
      const value = pair.slice(idx + 1).trim()
      return { name, value: decodeURIComponent(value) }
    })
    .filter(Boolean)
}

function buildSetCookieString(name, value, options = {}) {
  let cookie = `${name}=${encodeURIComponent(value)}`
  if (options.maxAge) cookie += `; Max-Age=${options.maxAge}`
  if (options.expires) cookie += `; Expires=${new Date(options.expires).toUTCString()}`
  if (options.domain) cookie += `; Domain=${options.domain}`
  if (options.path) cookie += `; Path=${options.path}`
  if (options.secure) cookie += `; Secure`
  if (options.httpOnly) cookie += `; HttpOnly`
  if (options.sameSite) cookie += `; SameSite=${options.sameSite}`
  return cookie
}

export async function middleware(request) {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SUPABASE_KEY =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    // dev: don't block, but warn. In prod you'd fail fast.
    // eslint-disable-next-line no-console
    console.warn('Missing Supabase env vars in middleware')
    return NextResponse.next()
  }

  const response = NextResponse.next()

  const cookieAdapter = {
    getAll() {
      const header = request.headers.get('cookie') || ''
      return parseCookieHeader(header)
    },
    setAll(cookiesToSet = []) {
      if (!Array.isArray(cookiesToSet)) return
      cookiesToSet.forEach(({ name, value, options = {} }) => {
        const cookieStr = buildSetCookieString(name, value, options)
        response.headers.append('Set-Cookie', cookieStr)
      })
    },
    // helpers
    get(name) {
      const all = cookieAdapter.getAll()
      const found = all.find((c) => c.name === name)
      return found ? found.value : undefined
    },
    set(name, value, options = {}) {
      cookieAdapter.setAll([{ name, value, options }])
    },
    remove(name, options = {}) {
      cookieAdapter.setAll([{ name, value: '', options: { ...options, expires: 0 } }])
    },
  }

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: cookieAdapter,
    request,
    response,
  })

  // revalidate session and let supabase set cookies on response if needed
  try {
    await supabase.auth.getUser()
  } catch (err) {
    // non-fatal; we'll still check user below
    // eslint-disable-next-line no-console
    console.warn('supabase.auth.getUser() failed in middleware:', err)
  }

  // Manual access check: redirect to /login when route is protected and user is missing
  const { data } = await supabase.auth.getUser()
  const user = data?.user

  // Only protect certain paths — adjust to your app's prefixes
  const url = request.nextUrl.clone()
  const protectedPrefixes = ['/private', '/dashboard', '/account', '/api/protected']

  const isProtected = protectedPrefixes.some((p) => url.pathname === p || url.pathname.startsWith(p + '/'))
  if (isProtected && !user) {
    url.pathname = '/SignInPage'
    url.searchParams.set('from', request.nextUrl.pathname)
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: ['/private/:path*', '/dashboard/:path*', '/account/:path*', '/api/protected/:path*'],
}
