import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import vs from 'vscode'
import WebSocket from 'ws'
import { BWRAP_COLLAB_SOCK_PATH, waitForPath, WorkspaceMetadata } from './util'

export class CollabServerConnection implements vs.Disposable {
  constructor(
    readonly collabSock: HocuspocusProviderWebsocket,
    readonly awarenessProvider: HocuspocusProvider,
  ) {}

  dispose() {
    this.awarenessProvider.destroy()
    this.collabSock.destroy()
  }
}

export async function connectToCollabServer(
  log: vs.LogOutputChannel,
  mdata: WorkspaceMetadata,
): Promise<CollabServerConnection | undefined> {
  const mk = () => {
    const collabSock = new HocuspocusProviderWebsocket({
      url: `ws+unix:${BWRAP_COLLAB_SOCK_PATH}:/`,
      // Must use the `ws` package for https://github.com/websockets/ws/blob/master/doc/ws.md#ipc-connections.
      WebSocketPolyfill: WebSocket,
    })
    log.debug('Opened collab-server socket')
    const awarenessProvider = new HocuspocusProvider({
      websocketProvider: collabSock,
      name: '<awareness>',
    })
    awarenessProvider.attach()
    awarenessProvider.setAwarenessField('user', {
      name: mdata.viewer.name,
      image: mdata.viewer.image,
    })
    return new CollabServerConnection(collabSock, awarenessProvider)
  }

  log.debug('Waiting for collab-server socket..')
  if (await waitForPath(BWRAP_COLLAB_SOCK_PATH, 5_000)) return mk()
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

  return undefined
}
