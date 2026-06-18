import { minimatch } from 'minimatch'
import fs from 'node:fs/promises'
import vs from 'vscode'
import { z } from 'zod'

/** Subset of {@link vs.LogOutputChannel} used for our purposes. */
export type Logger = Pick<vs.LogOutputChannel, 'logLevel' | 'trace' | 'debug' | 'info' | 'warn' | 'error'>

/** Wrap `log` so that every message is prepended with `prefix`. */
export function logWithPrefix(log: Logger, prefix: string): Logger {
  class PrefixedLogger {
    get logLevel() {
      return log.logLevel
    }
    trace(msg: string, ...args: unknown[]) {
      log.trace(`${prefix} ${msg}`, ...args)
    }
    debug(msg: string, ...args: unknown[]) {
      log.debug(`${prefix} ${msg}`, ...args)
    }
    info(msg: string, ...args: unknown[]) {
      log.info(`${prefix} ${msg}`, ...args)
    }
    warn(msg: string, ...args: unknown[]) {
      log.warn(`${prefix} ${msg}`, ...args)
    }
    error(msg: string | Error, ...args: unknown[]) {
      log.error(`${prefix} ${String(msg)}`, ...args)
    }
  }
  return new PrefixedLogger()
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
  /** Scheme, host, and port through which the browser reaches the workbench. */
  baseUrl: z.url(),
  /** User viewing/editing the current project. */
  viewer: z.object({
    name: z.string(),
    image: z.nullish(z.string()),
  }),
  /** Metadata about the current project. */
  project: z.object({
    name: z.string(),
    owner: z.object({
      name: z.string(),
    }),
  }),
  /** Files that should be synced collaboratively across viewers.
   * Patterns are matched with minimatch. */
  syncPatterns: z.array(z.string()),
  /** Files that should be excluded from collaborative sync.
   * Patterns are matched with minimatch. */
  excludeSyncPatterns: z.array(z.string()).optional(),
})

/** Metadata of a Lean Workbench project workspace. */
export type WorkspaceMetadata = z.infer<typeof zWorkspaceMetadata>

/** Whether `filePath` should be collaboratively synced,
 * i.e. it matches some {@link WorkspaceMetadata.syncPatterns} entry
 * and no {@link WorkspaceMetadata.excludeSyncPatterns} entry. */
export function shouldSyncPath(mdata: WorkspaceMetadata, filePath: string): boolean {
  const matches = (pattern: string) => minimatch(filePath, pattern, { dot: true })
  return mdata.syncPatterns.some(matches) && !(mdata.excludeSyncPatterns ?? []).some(matches)
}

/** Working directory of collab-server in the VSCode and collab-server bwraps. */
export const BWRAP_COLLAB_SERVER_DIR = '/workspace/.collab-server'

/** Collab-server socket path in the VSCode and collab-server bwraps. */
export const BWRAP_COLLAB_SOCK_PATH = `${BWRAP_COLLAB_SERVER_DIR}/collab.sock`

/** We keep a Y.Doc per collaboratively-editable file.
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
