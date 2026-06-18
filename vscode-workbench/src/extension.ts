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
    log.error(`failed to parse workspace metadata: ${String(err)}`)
    void vs.window.showErrorMessage('Could not parse Lean Workbench metadata - shutting down.')
    return undefined
  }

  return mdata
}

export async function activate(ctx: vs.ExtensionContext) {
  const log = vs.window.createOutputChannel('Lean 4 - Workbench', { log: true })

  const mdata = await readWorkspaceMdata(log)
  if (!mdata) return
  log.trace(`workspace metadata: ${JSON.stringify(mdata)}`)
  ctx.subscriptions.push(
    vs.commands.registerCommand('leanprover-workbench.previewFile', async (uri?: vs.Uri) => {
      uri ??= vs.window.activeTextEditor?.document.uri
      if (!uri) return
      const relPath = vs.workspace.asRelativePath(uri, false)
      // FIXME: this relies on the VSC iframe having access to session cookies.
      const url = `${mdata.baseUrl}/${mdata.project.owner.name}/${mdata.project.name}/preview/${relPath.split('/').map(encodeURIComponent).join('/')}`
      log.trace(`previewing '${uri.fsPath}' at '${url}'`)
      await vs.commands.executeCommand('simpleBrowser.api.open', vs.Uri.parse(url), {
        preserveFocus: true,
        viewColumn: vs.ViewColumn.Beside,
      })
    }),
  )

  const collabServer = await connectToCollabServer(log, mdata)
  if (!collabServer) return
  ctx.subscriptions.push(collabServer)

  const bindings = new YTextBindingManager(collabServer.collabSock, mdata, log)
  ctx.subscriptions.push(
    bindings,
    // Remote presence indicators
    new RemoteSelectionDecorator(collabServer.awareness),
  )

  // Panel with workbench-specific information
  const panel = new WorkbenchPanelProvider(collabServer.awareness, mdata, log)
  ctx.subscriptions.push(panel, vs.window.registerTreeDataProvider('leanprover-workbench-view', panel))

  log.debug('Extension activated')
}
