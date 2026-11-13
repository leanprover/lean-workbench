import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'

import { ARTIFACT_KINDS } from '@/lib/server/artifacts'
import { cookiePrefix, getUserSession } from '@/lib/server/auth'
import { getConfig } from '@/lib/server/config'

/**
 * Selects routes that should display the login page if not logged in.
 */
function routeShowsLogin(pathname: string) {
  if (pathname.startsWith('/api/')) return false
  if (pathname === '/' || pathname === '/login') return false

  // Exempt publications
  const threeSegment = pathname.match(/^\/([^/]+)\/([^/]+)\/([^/]+)(\/|$)/)
  if (threeSegment?.[3] && ARTIFACT_KINDS.some(kind => kind.id === threeSegment[3])) return false

  return true
}

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

  // Show the `/login` page if the user is not logged in and is viewing a page where log-in is required.
  // This rewrite does NOT have to happen with 100% success:
  // if the check is skipped, we'll show `unauthorized.tsx`, which is the same page as `/login`, possibly inside of a weird layout.tsx
  if (routeShowsLogin(request.nextUrl.pathname)) {
    const possiblyLoggedIn = getSessionCookie(request, { cookiePrefix: cookiePrefix(cfg) })
    if (!possiblyLoggedIn) {
      if (request.nextUrl.pathname === '/admin' || request.nextUrl.pathname === '/setup') {
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        url.search = '?admin=true'
        return NextResponse.redirect(url)
      }
      return NextResponse.rewrite(new URL('/login', request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Proxy all paths except static assets
    '/((?!_next/static/|_next/image|__nextjs|static/|favicon\\.ico$).*)',
  ],
}
