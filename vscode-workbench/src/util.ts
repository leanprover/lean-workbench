import fs from 'node:fs/promises'
import vs from 'vscode'
import { z } from 'zod'

/** Subset of {@link vs.LogOutputChannel} used for our purposes. */
export type Logger = Pick<vs.LogOutputChannel, 'trace' | 'debug' | 'info' | 'warn' | 'error'>

/** Wrap `log` so that every message is prepended with `prefix`. */
export function logWithPrefix(log: Logger, prefix: string): Logger {
  const wrap =
    (fn: (m: string, ...a: unknown[]) => void) =>
    (msg: string, ...args: unknown[]) =>
      fn(`${prefix} ${msg}`, ...args)
  return {
    trace: wrap(log.trace.bind(log)),
    debug: wrap(log.debug.bind(log)),
    info: wrap(log.info.bind(log)),
    warn: wrap(log.warn.bind(log)),
    error: (msg, ...args) => log.error(`${prefix} ${String(msg)}`, ...args),
  }
}

export function equalMaps<T, U>(a: Map<T, U>, b: Map<T, U>, eqU?: (a: U, b: U) => boolean): boolean {
  if (a.size !== b.size) return false
  for (const [id, u] of a) {
    if (!b.has(id)) return false
    const v = b.get(id) as U
    if (eqU ? !eqU(v, u) : v !== u) return false
  }
  return true
}

// FIXME: use same consts in workbench-app/collab-server for single source of truth.

/** Path to workspace metadata file in VSCode bwraps. */
export const BWRAP_METADATA_PATH = '/workspace/.lean-workbench.json'

export const zWorkspaceMetadata = z.object({
  /** Name of the user viewing/editing the project. */
  viewer: z.object({
    name: z.string(),
    image: z.nullish(z.string()),
  }),
})

/** Metadata of a Lean Workbench project workspace. */
export type WorkspaceMetadata = z.infer<typeof zWorkspaceMetadata>

/** Working directory of collab-server in the VSCode and collab-server bwraps. */
export const BWRAP_COLLAB_SERVER_DIR = '/workspace/.collab-server'

/** Collab-server socket path in the VSCode and collab-server bwraps. */
export const BWRAP_COLLAB_SOCK_PATH = `${BWRAP_COLLAB_SERVER_DIR}/collab.sock`

/** We keep a unique Y.Doc per file.
 * This is the Y.Doc key under which the text content lives. */
export const YTEXT_KEY = 'content'

export interface Position {
  line: number
  character: number
}

export interface Selection {
  anchor: Position
  active: Position
}

export interface AwarenessUser {
  name: string
  color: string
  image?: string | null
}

export function equalAwarenessUsers(u: AwarenessUser, v: AwarenessUser): boolean {
  return v.name === u.name && v.color === u.color && v.image === u.image
}

export const AWARENESS_DOC_NAME = '<awareness>'
export const AWARENESS_USER_KEY = 'user'
export const AWARENESS_SELECTION_KEY = 'selection'
/** Colors for remote collaborator cursors. */
export const AWARENESS_CURSOR_COLORS = ['#5790FC', '#F89C20', '#E42536', '#964A8B', '#9C9CA1', '#7A21DD']

export interface AwarenessSelection {
  filePath: string
  selections: Selection[]
}

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
