import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'

import { cookiePrefix, getUserSession } from './lib/server/auth'
import { getConfig } from './lib/server/config'

export async function proxy(request: NextRequest) {
  const cfg = getConfig()
  if (!cfg.isSetupComplete) {
    const path = request.nextUrl.pathname
    const allowedRoutes = ['/setup', '/api/admin/tracked-command/seed']
    const allowedPrefixes = ['/api/auth/']
    if (allowedRoutes.includes(path) || allowedPrefixes.some(p => path.startsWith(p))) return NextResponse.next()
    if (path.startsWith('/api/')) return NextResponse.json({ error: 'Setup not complete' }, { status: 503 })
    // https://nextjs.org/docs/messages/proxy-relative-urls#possible-ways-to-fix-it
    const url = request.nextUrl.clone()
    url.pathname = '/setup'
    return NextResponse.redirect(url)
  }

  // If logged in, send `/` and `/login` to `/:userName`
  if (request.nextUrl.pathname === '/' || request.nextUrl.pathname === '/login') {
    const session = await getUserSession()
    if (session) {
      const url = request.nextUrl.clone()
      url.pathname = `/${session.user.name}`
      url.search = ''
      return NextResponse.redirect(url)
    }
  }

  // Inexpensive check for whether the user has a login cookie. Doesn't check that the cookie is valid!
  const possiblyLoggedIn = getSessionCookie(request, { cookiePrefix: cookiePrefix(cfg) })

  // Forward logged-out users from `/admin` to `/login?admin=true
  if (!possiblyLoggedIn && request.nextUrl.pathname === '/admin') {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = '?admin=true'
    return NextResponse.redirect(url)
  }

  // Workaround for the weird page rendering caused by https://github.com/vercel/next.js/issues/96361
  // The regex needs to match all routes in the `(settings)` group
  if (!possiblyLoggedIn && request.nextUrl.pathname.match(/^\/(settings|admin)($|\/)/)) {
    return NextResponse.rewrite(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Proxy all paths except static assets
    '/((?!_next/static/|_next/image|__nextjs|static/|favicon\\.ico$).*)',
  ],
}
