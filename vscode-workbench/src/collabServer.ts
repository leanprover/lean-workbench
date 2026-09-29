import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { COLLAB_TRPC_ROUTE, type CollabRouter } from '@leanprover/workbench-collab-server'
import { BWRAP_COLLAB_SOCK_PATH, type WorkspaceMetadata } from '@leanprover/workbench-shared'
import { waitForFileToExist } from '@leanprover/workbench-shared/node'
import { createTRPCClient, createWSClient, type TRPCClient, type TRPCWebSocketClient, wsLink } from '@trpc/client'
import vs from 'vscode'
import WebSocket from 'ws'
import type { Awareness } from 'y-protocols/awareness'

import { AWARENESS_CURSOR_COLORS, AWARENESS_DOC_NAME, AWARENESS_USER_KEY, type AwarenessUser } from './util'

/** The part of {@link CollabServerConnection} used to sync text buffers.
 * Instantiated differently in tests. */
export type CollabServerTextIface = Pick<CollabServerConnection, 'collabSock' | 'tRpc'>

export class CollabServerConnection implements vs.Disposable {
  constructor(
    readonly collabSock: HocuspocusProviderWebsocket,
    private readonly tRpcWs: TRPCWebSocketClient,
    readonly tRpc: TRPCClient<CollabRouter>,
    private readonly awarenessProvider: HocuspocusProvider,
  ) {}

  dispose() {
    this.awarenessProvider.destroy()
    void this.tRpcWs.close()
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
  try {
    await waitForFileToExist(BWRAP_COLLAB_SOCK_PATH, { timeoutMs: 5_000, pollMs: 200 })
  } catch {
    showErrorModal()
    return undefined
  }

  const collabSock = new HocuspocusProviderWebsocket({
    url: `ws+unix:${BWRAP_COLLAB_SOCK_PATH}:/`,
    // Must use the `ws` package for https://github.com/websockets/ws/blob/master/doc/ws.md#ipc-connections.
    WebSocketPolyfill: WebSocket,
  })

  const tRpcWs = createWSClient({
    url: `ws+unix:${BWRAP_COLLAB_SOCK_PATH}:${COLLAB_TRPC_ROUTE}`,
    WebSocket: WebSocket as unknown as typeof globalThis.WebSocket,
  })
  const tRpc = createTRPCClient<CollabRouter>({ links: [wsLink({ client: tRpcWs })] })

  log.debug('Opened Hocuspocus and tRPC connections to the collab-server socket')

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

  return new CollabServerConnection(collabSock, tRpcWs, tRpc, awarenessProvider)
}
