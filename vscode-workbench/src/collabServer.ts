import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import vs from 'vscode'
import WebSocket from 'ws'
import type { Awareness } from 'y-protocols/awareness'

import {
  AWARENESS_CURSOR_COLORS,
  AWARENESS_DOC_NAME,
  AWARENESS_USER_KEY,
  type AwarenessUser,
  BWRAP_COLLAB_SOCK_PATH,
  waitForPath,
  type WorkspaceMetadata,
} from './util'

export class CollabServerConnection implements vs.Disposable {
  constructor(
    readonly collabSock: HocuspocusProviderWebsocket,
    private readonly awarenessProvider: HocuspocusProvider,
  ) {}

  dispose() {
    this.awarenessProvider.destroy()
    this.collabSock.destroy()
  }

  get awareness(): Awareness {
    return this.awarenessProvider.awareness!
  }
}

export async function connectToCollabServer(
  log: vs.LogOutputChannel,
  mdata: WorkspaceMetadata,
): Promise<CollabServerConnection | undefined> {
  const showErrorModal = () => {
    const action = 'Reload window'
    void vs.window
      .showErrorMessage(
        'Collaboration server is not available - Lean Workbench will not function correctly.',
        { modal: true },
        action,
      )
      .then(async s => {
        if (s === action) {
          await vs.commands.executeCommand('workbench.action.reloadWindow')
        }
      })
  }

  log.debug('Waiting for collab-server socket..')
  if (!(await waitForPath(BWRAP_COLLAB_SOCK_PATH, 5_000))) {
    showErrorModal()
    return undefined
  }

  const collabSock = new HocuspocusProviderWebsocket({
    url: `ws+unix:${BWRAP_COLLAB_SOCK_PATH}:/`,
    // Must use the `ws` package for https://github.com/websockets/ws/blob/master/doc/ws.md#ipc-connections.
    WebSocketPolyfill: WebSocket,
  })
  log.debug('Opened collab-server socket')

  const awarenessProvider = new HocuspocusProvider({
    websocketProvider: collabSock,
    name: AWARENESS_DOC_NAME,
  })
  awarenessProvider.attach()
  // Wait so we can see other clients' colors before picking ours.
  if (!awarenessProvider.isSynced) {
    const success = await new Promise<boolean>(resolve => {
      awarenessProvider.on('synced', () => resolve(true))
      setTimeout(() => resolve(false), 5_000)
    })
    if (!success) {
      showErrorModal()
      return undefined
    }
  }

  // Pick the color least used by other clients. Ties are broken by list order.
  const awareness = awarenessProvider.awareness!
  const counts = new Map<string, number>(AWARENESS_CURSOR_COLORS.map(c => [c, 0]))
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === awareness.clientID) continue
    const user = state[AWARENESS_USER_KEY] as AwarenessUser | undefined
    if (!user) continue
    counts.set(user.color, (counts.get(user.color) ?? 0) + 1)
  }
  const color = AWARENESS_CURSOR_COLORS.reduce(
    (acc, c) => (counts.get(acc)! <= counts.get(c)! ? acc : c),
    AWARENESS_CURSOR_COLORS[0]!,
  )

  awarenessProvider.setAwarenessField(AWARENESS_USER_KEY, {
    name: mdata.viewer.name,
    image: mdata.viewer.image,
    color,
  } satisfies AwarenessUser)

  return new CollabServerConnection(collabSock, awarenessProvider)
}
