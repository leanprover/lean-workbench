import fs from 'node:fs/promises'
import vs from 'vscode'
import { connectToCollabServer } from './collabServer'
import { YTextBindingManager } from './textBinding'
import { BWRAP_COLLAB_SERVER_DIR } from './util'

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

function syncableDirs(): string[] {
  return (vs.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file').map(f => f.uri.fsPath)
}

export async function activate(ctx: vs.ExtensionContext) {
  const log = vs.window.createOutputChannel('Lean 4 - Workbench', { log: true })

  if (!(await ensureWorkbenchEnv(log))) return

  const collabServer = await connectToCollabServer(log)
  if (!collabServer) return
  ctx.subscriptions.push(collabServer)

  // We apply collaborative syncing to open folders (usually just the project folder) only.
  // User-specific folders such as /workspace/.vscode-remote are not synced
  // (though they would be if someone opens /workspace - TODO better UX).
  const bindings = new YTextBindingManager(collabServer, syncableDirs(), log)
  ctx.subscriptions.push(
    bindings,
    vs.workspace.onDidChangeWorkspaceFolders(() => bindings.updateSyncableDirs(syncableDirs())),
  )
  log.debug('Extension activated')
}
