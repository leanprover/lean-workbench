import fs from 'node:fs/promises'

// FIXME: use same consts in workbench-app/collab-server for single source of truth.

/** Working directory of collab-server in the VSCode and collab-server bwraps. */
export const BWRAP_COLLAB_SERVER_DIR = '/workspace/.collab-server'

/** Collab-server socket path in the VSCode and collab-server bwraps. */
export const BWRAP_COLLAB_SOCK_PATH = `${BWRAP_COLLAB_SERVER_DIR}/collab.sock`

/** We keep a unique Y.Doc per file.
 * This is the Y.Doc key under which the text content lives. */
export const YTEXT_KEY = 'content'

export async function waitForPath(p: string, timeoutMs: number): Promise<boolean> {
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
