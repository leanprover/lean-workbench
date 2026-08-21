import { forbidden } from 'next/navigation'

import { requireAuth } from '@/lib/server/auth'
import { getEditorSessionManager } from '@/lib/server/editorSessions'

/** Queried by Nginx to ensure the sending user can access the given view session.
 * Any 2xx response counts for successful authentication,
 * whereas other codes cause Nginx to reject the original request. */
export async function GET(req: Request) {
  const uri = req.headers.get('x-auth-uri') ?? ''
  const match = uri.match(/^\/_view\/[^/]+\/([^/]+)\/.*$/)
  if (!match) forbidden()
  const sessionId = match[1]!
  const userSession = await requireAuth()
  const socketPath = getEditorSessionManager().viewSocketPathForViewer(userSession.user.id, sessionId)
  if (!socketPath) forbidden()
  return new Response(null, { status: 200, headers: { 'X-Socket-Path': socketPath } })
}
