import { requireAuth } from '@/lib/server/actions'
import { getEditorSessionManager } from '@/lib/server/editorSessions'
import { forbidden } from 'next/navigation'

/** Queried by Nginx to ensure the sending user can access the given editor session. */
export async function GET(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const userSession = await requireAuth()
  if (!getEditorSessionManager().isViewerOf(userSession.user.id, sessionId)) forbidden()
  return new Response(null, { status: 200 })
}
