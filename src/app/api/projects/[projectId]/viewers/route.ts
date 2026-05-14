import { requireAuth } from '@/lib/server/actions'
import { User } from '@/lib/server/auth'
import { getDb } from '@/lib/server/db'
import { getEditorSessionManager } from '@/lib/server/editorSessions'
import { canAccessProject, sseStreamResponse } from '@/lib/server/util'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import WebSocket from 'ws'

/** Document name of the dedicated awareness channel.
 * Must match the name used by the VSCode workbench extension. */
const AWARENESS_DOC_NAME = '<awareness>'

export type Viewer = Pick<User, 'name' | 'image'>

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const session = await requireAuth()

  // Viewers list is only visible to people who can see the project.
  const project = await getDb().project.findUnique({ where: { id: projectId } })
  if (!project || !canAccessProject(session.user, project)) {
    return new Response('Not found', { status: 404 })
  }

  let cleanup = () => {}
  const [response, send, close] = sseStreamResponse(() => {
    cleanup()
  })
  send({ viewers: [] })

  // For the first user to start editing,
  // this request is made right after the one that constructs the `CollabServerHandle`.
  // Look for it a few times before giving up.
  let collabServer = getEditorSessionManager().getCollabServer(projectId)
  for (let attempt = 1; attempt < 5 && !collabServer; attempt++) {
    await new Promise(r => setTimeout(r, 100))
    collabServer = getEditorSessionManager().getCollabServer(projectId)
  }
  if (!collabServer) {
    close()
    return response
  }
  await collabServer.start()

  // FIXME: store a connection in `CollabServerHandle`. No need to make one per GET.
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: `ws+unix:${collabServer.socketPath}:/`,
    // The `ws` package is required for unix socket (IPC) connections.
    WebSocketPolyfill: WebSocket,
  })
  const hs = new HocuspocusProvider({
    websocketProvider,
    name: AWARENESS_DOC_NAME,
    onAwarenessChange({ states }) {
      // One user can appear multiple times in the CRDT after reconnecting: deduplicate.
      const seenNames = new Set<string>()
      const viewers: Viewer[] = []
      for (const s of states) {
        if (!s.user || seenNames.has(s.user.name)) continue
        viewers.push(s.user)
        seenNames.add(s.user.name)
      }
      send({ viewers })
    },
  })
  hs.attach()
  cleanup = () => {
    hs.destroy()
    websocketProvider.destroy()
  }

  return response
}
