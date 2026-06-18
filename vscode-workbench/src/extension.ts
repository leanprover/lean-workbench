import fs from 'node:fs/promises'
import path from 'node:path'
import vs from 'vscode'
import { connectToCollabServer } from './collabServer'
import { WorkbenchPanelProvider } from './panel'
import { RemoteSelectionDecorator } from './remoteSelections'
import { YTextBindingManager } from './textBinding'
import { BWRAP_METADATA_PATH, bwrapProjectDir, WorkspaceMetadata, zWorkspaceMetadata } from './util'

/** Ensure we are in the expected Lean Workbench environment
 * and return the current workspace configuration.
 * Otherwise display an error and return `undefined`. */
async function readWorkspaceMdata(log: vs.LogOutputChannel): Promise<WorkspaceMetadata | undefined> {
  let mdata: WorkspaceMetadata
  try {
    const raw = await fs.readFile(BWRAP_METADATA_PATH, 'utf8')
    mdata = zWorkspaceMetadata.parse(JSON.parse(raw))
  } catch (err) {
    log.error(`Failed to parse workspace metadata: ${String(err)}`)
    void vs.window.showErrorMessage('Could not parse Lean Workbench metadata - shutting down.')
    return undefined
  }

  return mdata
}

/** Ensure the project folder is the only open workspace folder.
 * If not, warn the user with an offer to reopen it and return `false`. */
async function ensureProjectFolderOpen(mdata: WorkspaceMetadata, log: vs.LogOutputChannel): Promise<boolean> {
  log.debug(`Workspace file: ${JSON.stringify(vs.workspace.workspaceFile)}`)
  log.debug(`Workspace folders: ${JSON.stringify(vs.workspace.workspaceFolders)}`)

  const expected = bwrapProjectDir(mdata.project.name)
  if (
    vs.workspace.workspaceFolders?.length === 1 &&
    path.resolve(vs.workspace.workspaceFolders[0].uri.fsPath) === path.resolve(expected)
  )
    return true

  const reopen = 'Open Project Folder'
  const choice = await vs.window.showErrorMessage(
    `The project folder ${expected} is not open. Lean Workbench may not function correctly.`,
    reopen,
  )
  if (choice === reopen) await vs.commands.executeCommand('vscode.openFolder', vs.Uri.file(expected))
  return false
}

export async function activate(ctx: vs.ExtensionContext) {
  const log = vs.window.createOutputChannel('Lean 4 - Workbench', { log: true })

  const mdata = await readWorkspaceMdata(log)
  if (!mdata) return
  log.debug(`Workspace metadata: ${JSON.stringify(mdata)}`)

  if (!(await ensureProjectFolderOpen(mdata, log))) return

  ctx.subscriptions.push(
    vs.commands.registerCommand('leanprover-workbench.previewFile', async (uri?: vs.Uri) => {
      uri ??= vs.window.activeTextEditor?.document.uri
      if (!uri) return
      const relPath = vs.workspace.asRelativePath(uri, false)
      // FIXME: this relies on the VSC iframe having access to session cookies.
      const url = `${mdata.baseUrl}/${mdata.project.owner.name}/${mdata.project.name}/preview/${relPath.split('/').map(encodeURIComponent).join('/')}`
      log.trace(`Previewing '${uri.fsPath}' at '${url}'`)
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
