import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "./lib/server/config";

export async function proxy(request: NextRequest) {
    const cfg = getConfig()
    if (!cfg.isSetupComplete) {
        const path = request.nextUrl.pathname
        const allowedPrefixes = ['/static/', '/_next/static/', '/api/setup/']
        if (path === '/setup' || allowedPrefixes.some(p => path.startsWith(p)))
            return NextResponse.next()
        if (path.startsWith('/api/'))
            return NextResponse.json({ error: 'Setup not complete' }, { status: 503 })
        // https://nextjs.org/docs/messages/proxy-relative-urls#possible-ways-to-fix-it
        const url = request.nextUrl.clone()
        url.pathname = '/setup'
        return NextResponse.redirect(url)
    }
    return NextResponse.next();
}