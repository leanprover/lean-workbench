import { type NextRequest, NextResponse } from 'next/server'

import { getUserSession } from './lib/server/auth'
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
  if (request.nextUrl.pathname === '/' || request.nextUrl.pathname === '/login') {
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
    '/((?!_next/static/|_next/image|__nextjs|static/|favicon\\.ico$).*)',
  ],
}
