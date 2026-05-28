import fs from 'node:fs/promises'
import vs from 'vscode'
import { connectToCollabServer } from './collabServer'
import { WorkbenchPanelProvider } from './panel'
import { RemoteSelectionDecorator } from './remoteSelections'
import { YTextBindingManager } from './textBinding'
import { BWRAP_METADATA_PATH, WorkspaceMetadata, zWorkspaceMetadata } from './util'

/** Ensure we are in the expected Lean Workbench environment
 * and return the current workspace configuration.
 * Otherwise display an error and return `undefined`. */
async function readWorkspaceMdata(log: vs.LogOutputChannel): Promise<WorkspaceMetadata | undefined> {
  log.debug(`Workspace file: ${JSON.stringify(vs.workspace.workspaceFile)}`)
  log.debug(`Workspace folders: ${JSON.stringify(vs.workspace.workspaceFolders)}`)

  let mdata: WorkspaceMetadata
  try {
    const raw = await fs.readFile(BWRAP_METADATA_PATH, 'utf8')
    mdata = zWorkspaceMetadata.parse(JSON.parse(raw))
  } catch (err) {
    log.error(String(err))
    void vs.window.showErrorMessage('Could not detect the Lean Workbench - shutting down.')
    return undefined
  }

  return mdata
}

function syncableDirs(): string[] {
  return (vs.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file').map(f => f.uri.fsPath)
}

export async function activate(ctx: vs.ExtensionContext) {
  const log = vs.window.createOutputChannel('Lean 4 - Workbench', { log: true })

  const mdata = await readWorkspaceMdata(log)
  if (!mdata) return

  const collabServer = await connectToCollabServer(log, mdata)
  if (!collabServer) return
  ctx.subscriptions.push(collabServer)

  // We apply collaborative syncing to open folders (usually just the project folder) only.
  // User-specific folders such as /workspace/.vscode-remote are not synced
  // (though they would be if someone opens /workspace - TODO better UX).
  const bindings = new YTextBindingManager(collabServer, syncableDirs(), log)
  ctx.subscriptions.push(
    bindings,
    vs.workspace.onDidChangeWorkspaceFolders(() => bindings.updateSyncableDirs(syncableDirs())),
    // Remote presence indicators
    new RemoteSelectionDecorator(collabServer.awareness),
  )

  // Panel with workbench-specific information
  const panel = new WorkbenchPanelProvider(collabServer.awareness, mdata, log)
  ctx.subscriptions.push(panel, vs.window.registerTreeDataProvider('leanprover-workbench-view', panel))

  log.debug('Extension activated')
}
