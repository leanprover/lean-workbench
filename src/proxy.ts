import { type NextRequest, NextResponse } from 'next/server'

import { getUserSession } from './lib/server/auth'
import { getConfig } from './lib/server/config'

export async function proxy(request: NextRequest) {
  const cfg = getConfig()
  if (!cfg.isSetupComplete) {
    const path = request.nextUrl.pathname
    const allowedPrefixes = ['/setup', '/api/admin/tracked-command/seed', '/api/auth', '/favicon.ico']
    if (allowedPrefixes.some(p => path.startsWith(p))) return NextResponse.next()
    if (path.startsWith('/api/')) return NextResponse.json({ error: 'Setup not complete' }, { status: 503 })
    // https://nextjs.org/docs/messages/proxy-relative-urls#possible-ways-to-fix-it
    const url = request.nextUrl.clone()
    url.pathname = '/setup'
    return NextResponse.redirect(url)
  }
  if (request.nextUrl.pathname === '/') {
    const session = await getUserSession()
    if (session) {
      const url = request.nextUrl.clone()
      url.pathname = `/${session.user.name}`
      url.search = ''
      return NextResponse.redirect(url)
    }
  }
  return NextResponse.next()
}

export const config = {
  matcher: [
    // Proxy all paths except static assets
    '/((?!_next/static/|static/).*)',
  ],
}
