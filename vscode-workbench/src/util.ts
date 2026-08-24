import { type WorkspaceMetadata } from '@leanprover/workbench-shared'
import { minimatch } from 'minimatch'
import vs from 'vscode'

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

/** Whether `filePath` should be collaboratively synced,
 * i.e. it matches some {@link WorkspaceMetadata.syncPatterns} entry
 * and no {@link WorkspaceMetadata.excludeSyncPatterns} entry. */
export function shouldSyncPath(mdata: WorkspaceMetadata, filePath: string): boolean {
  const matches = (pattern: string) => minimatch(filePath, pattern, { dot: true })
  return mdata.syncPatterns.some(matches) && !(mdata.excludeSyncPatterns ?? []).some(matches)
}

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

export interface AwarenessSelections {
  filePath: string
  selections: Selection[]
}

// Copied (with changes) from vscode-lean4
/**
 * Ensures that a buffer is open to view `fsPath`.
 *
 * If `selection` is provided, sets the selection and scrolls it into view.
 *
 * Unless `preserveFocus` is truthy, the relevant buffer will also be switched into focus.
 */
export async function revealEditorSelection(fsPath: string, selection?: vs.Selection, preserveFocus = false) {
  // Look for an already-visible text editor, preferring one that is also already in focus
  const editors = vs.window.visibleTextEditors.filter(v => v.document.uri.fsPath === fsPath)
  let editor = editors.find(v => v === vs.window.activeTextEditor) ?? editors[0]
  if (editor === undefined) {
    editor = await vs.window.showTextDocument(vs.Uri.file(fsPath), {
      viewColumn: vs.window.activeTextEditor?.viewColumn ?? vs.ViewColumn.One,
      preserveFocus,
    })
  }
  if (selection !== undefined) {
    editor.revealRange(selection, vs.TextEditorRevealType.InCenterIfOutsideViewport)
    editor.selection = selection
    if (preserveFocus) return
    // ensure the text document has the keyboard focus.
    await vs.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preserveFocus: false })
  }
}
