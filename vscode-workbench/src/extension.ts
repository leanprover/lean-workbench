import { HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import fs from 'node:fs/promises'
import vs from 'vscode'
import WebSocket from 'ws'
import { RemoteDocManager } from './remoteDoc'
import { registerTextDocumentBindings } from './textBinding'
import { BWRAP_COLLAB_SERVER_DIR, BWRAP_COLLAB_SOCK_PATH } from './util'

/** Ensure we are in the expected Lean Workbench environment.
 * Return `false` if we are not,
 * prompting the user to fix this whenever possible. */
async function ensureWorkbenchEnv(log: vs.LogOutputChannel): Promise<boolean> {
  log.debug(`Workspace file: ${JSON.stringify(vs.workspace.workspaceFile)}`)
  log.debug(`Workspace folders: ${JSON.stringify(vs.workspace.workspaceFolders)}`)

  try {
    await fs.access(BWRAP_COLLAB_SERVER_DIR)
  } catch (err) {
    log.error(String(err))
    void vs.window.showErrorMessage('Could not detect the Lean Workbench - shutting down.')
    return false
  }

  return true
}

async function waitForPath(p: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fs.access(p)
      return true
    } catch {}
    await new Promise(r => setTimeout(r, 200))
  }
  return false
}

async function connectToCollabServer(
  ctx: vs.ExtensionContext,
  log: vs.LogOutputChannel,
): Promise<HocuspocusProviderWebsocket | undefined> {
  const mk = () => {
    const collabSock = new HocuspocusProviderWebsocket({
      url: `ws+unix:${BWRAP_COLLAB_SOCK_PATH}:/`,
      // Must use the `ws` package for https://github.com/websockets/ws/blob/master/doc/ws.md#ipc-connections.
      WebSocketPolyfill: WebSocket,
    })
    ctx.subscriptions.push({
      dispose() {
        collabSock.destroy()
      },
    })
    log.debug('Opened collab-server socket')
    return collabSock
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

export async function activate(ctx: vs.ExtensionContext) {
  const log = vs.window.createOutputChannel('Lean 4 - Workbench', { log: true })

  if (!(await ensureWorkbenchEnv(log))) return

  const collabSock = await connectToCollabServer(ctx, log)
  if (!collabSock) return

  const docs = new RemoteDocManager(collabSock, log)
  registerTextDocumentBindings(ctx, docs, log)
  log.debug('Extension activated')
}
