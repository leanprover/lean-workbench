import { HocuspocusProvider } from '@hocuspocus/provider'
import path from 'node:path'
import vs from 'vscode'
import * as Y from 'yjs'
import { CollabServerConnection } from './collabServer'
import { AWARENESS_SELECTION_KEY, AwarenessSelection, Logger, logWithPrefix, YTEXT_KEY } from './util'

/** Maintains a {@link YTextBinding} binding for every open {@link vs.TextDocument}
 * whose path lies within one of the syncable directories. */
export class YTextBindingManager implements vs.Disposable {
  private bindings = new Map<string, YTextBinding>()
  private disposables: vs.Disposable[] = []

  constructor(
    private readonly collabServer: CollabServerConnection,
    /** Directories to sync. Files not contained in any of these are not synced. */
    private syncDirs: string[],
    private readonly log: vs.LogOutputChannel,
  ) {
    this.disposables.push(
      vs.workspace.onDidOpenTextDocument(doc => this.onDidOpenTextDocument(doc)),
      vs.workspace.onDidCloseTextDocument(doc => this.onDidCloseTextDocument(doc)),
      vs.workspace.onDidChangeTextDocument(e => this.onDidChangeTextDocument(e)),
      vs.window.onDidChangeTextEditorSelection(e => this.onDidChangeTextEditorSelection(e)),
    )
    // Bind already-open buffers
    for (const doc of vs.workspace.textDocuments) this.onDidOpenTextDocument(doc)
  }

  /** Replace the set of syncable directories. */
  updateSyncableDirs(syncDirs: string[]) {
    this.syncDirs = syncDirs
    // Tear down bindings no longer in any syncable dir
    for (const [filePath, binding] of this.bindings) {
      if (this.shouldSyncPath(filePath)) continue
      this.bindings.delete(filePath)
      binding.dispose()
    }
    // Rebind already-open buffers in case they are now syncable
    // (no-op if already bound)
    for (const doc of vs.workspace.textDocuments) this.onDidOpenTextDocument(doc)
  }

  private shouldSyncPath(filePath: string): boolean {
    return this.syncDirs.some(d => {
      const rel = path.relative(d, filePath)
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
    })
  }

  private onDidOpenTextDocument(doc: vs.TextDocument) {
    if (doc.uri.scheme !== 'file') return
    const filePath = doc.uri.fsPath
    if (!this.shouldSyncPath(filePath)) return
    // TODO: can one path have multiple `TextDocument`s?
    if (this.bindings.has(filePath)) return
    this.bindings.set(filePath, new YTextBinding(doc, this.collabServer, this.log))
  }

  private onDidCloseTextDocument(doc: vs.TextDocument) {
    if (doc.uri.scheme !== 'file') return
    const filePath = doc.uri.fsPath
    const binding = this.bindings.get(filePath)
    if (!binding) return
    this.bindings.delete(filePath)
    binding.dispose()
  }

  private onDidChangeTextDocument(e: vs.TextDocumentChangeEvent) {
    if (e.document.uri.scheme !== 'file') return
    const filePath = e.document.uri.fsPath
    const binding = this.bindings.get(filePath)
    if (!binding) {
      if (this.shouldSyncPath(filePath)) {
        this.log.warn(`[onDidChangeTextDocument] dropped edit on '${filePath}', missing YTextBinding`)
      }
      return
    }
    binding.onLocalChange(e)
  }

  private onDidChangeTextEditorSelection(e: vs.TextEditorSelectionChangeEvent) {
    if (e.textEditor.document.uri.scheme !== 'file') return
    const filePath = e.textEditor.document.uri.fsPath
    const binding = this.bindings.get(filePath)
    if (!binding) return
    binding.onDidChangeTextEditorSelection(e)
  }

  dispose() {
    for (const d of this.disposables) d.dispose()
    this.disposables = []
    for (const b of this.bindings.values()) b.dispose()
    this.bindings.clear()
  }
}

/** Whether the given {@link vs.TextDocumentChangeEvent} should be broadcast to other clients. */
function shouldBroadcastChange(e: vs.TextDocumentChangeEvent): boolean {
  if (e.contentChanges.length === 0) return false
  if (!e.detailedReason) return false

  // Keyboard inputs
  if (e.detailedReason.source === 'cursor') return true
  // Undo, redo
  if (e.detailedReason.source === 'applyEdits') return true
  // Autocompletion
  if (e.detailedReason.source === 'suggest') return true
  // 'Format Document' command
  if (e.detailedReason.metadata.name === 'formatEditsCommand') return true
  // Various causes, notably `vs.workspace.applyEdit`
  if (e.detailedReason.source === 'unknown') {
    // VSCodeVim
    if (e.detailedReason.metadata.name === 'MainThreadTextEditor') return true
    // TODO the `unknown` check is *incomplete*:
    // we must not broadcast `applyEdit`s that apply remote changes
    // (since that would cause an infinite broadcast loop),
    // but we should broadcast other `applyEdit`s.
    // However, there is no way in `applyEdit` to set the `detailedReason`,
    // or any other field of the resulting `TextDocumentChangeEvent`,
    // and checking document versions or edit content
    // turned out prone to a number of race conditions.
    // The only viable fix seems to be patching `openvscode-server`
    // to support setting `detailedReason.source` in `applyEdit`.
    return false
  }
  // File re-read from disk
  // (Redundant with blanket `return false` but recorded for clarity)
  if (e.detailedReason.source === 'reloadFromDisk') return false

  return false
}

/** Bidirectional binding between a {@link vs.TextDocument}
 * and the {@link Y.Text} of a Hocuspocus document. */
export class YTextBinding implements vs.Disposable {
  private ytext: Y.Text
  private hs: HocuspocusProvider

  private initialSyncDone = false
  /** Used to linearize and order async operations that might otherwise interleave. */
  private pending: Promise<void> = Promise.resolve()

  private disposables: { dispose(): unknown }[] = []

  private readonly log: Logger

  constructor(
    private readonly doc: vs.TextDocument,
    private readonly collabServer: CollabServerConnection,
    log_: vs.LogOutputChannel,
  ) {
    this.log = logWithPrefix(log_, `[YTextBinding(${doc.uri.fsPath})]`)

    // https://tiptap.dev/docs/hocuspocus/provider/examples#multiplexing
    this.hs = new HocuspocusProvider({
      websocketProvider: this.collabServer.collabSock,
      name: doc.uri.fsPath,
      // We use a single, global awareness CRDT rather than per-document CRDTs.
      awareness: null,
    })
    this.hs.attach()

    this.ytext = this.hs.document.getText(YTEXT_KEY)

    const observer = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      // First check prevents bounceback (https://beta.yjs.dev/docs/api/transactions/#the-origin-concept).
      // Second ignores remote deltas before initial sync of remote doc.
      if (transaction.origin === this || !this.initialSyncDone) return
      const delta = event.delta
      this.enqueue(() => this.applyDelta(delta))
    }
    this.ytext.observe(observer)
    this.disposables.push({
      dispose: () => {
        this.ytext.unobserve(observer)
      },
    })

    if (this.hs.synced) {
      this.enqueue(() => this.initialSync())
    } else {
      const onSynced = () => {
        this.hs.off('synced', onSynced)
        this.enqueue(() => this.initialSync())
      }
      this.hs.on('synced', onSynced)
    }
  }

  /** Place an operation on the work queue.
   * Work items are atomic w.r.t. all other work items
   * (but not w.r.t. other `async` operations). */
  private enqueue(work: () => Promise<void>): void {
    this.pending = this.pending.then(work).catch(e => {
      this.log.error(e)
    })
  }

  onLocalChange(e: vs.TextDocumentChangeEvent): void {
    if (e.document !== this.doc) throw new Error('internal error: YTextBinding received event for wrong document')
    if (!this.initialSyncDone) return
    this.log.trace(`[onLocalChange] ${JSON.stringify(e)}`)
    if (!shouldBroadcastChange(e)) return
    // Broadcast the local change to other clients through collab-server.
    this.hs.document.transact(() => {
      // VSCode sorts `contentChanges` in reverse offset order
      // so they can be applied sequentially without offset adjustment.
      for (const ch of e.contentChanges) {
        if (ch.rangeLength) this.ytext.delete(ch.rangeOffset, ch.rangeLength)
        if (ch.text) this.ytext.insert(ch.rangeOffset, ch.text)
      }
    }, this)
  }

  onDidChangeTextEditorSelection(e: vs.TextEditorSelectionChangeEvent) {
    if (e.textEditor.document !== this.doc) return
    this.collabServer.awareness.setLocalStateField(AWARENESS_SELECTION_KEY, {
      filePath: this.doc.uri.fsPath,
      // FIXME: use LSP types
      selections: e.selections.map(s => ({
        anchor: { line: s.anchor.line, character: s.anchor.character },
        active: { line: s.active.line, character: s.active.character },
      })),
    } satisfies AwarenessSelection)
  }

  /** Ensure that buffer contents match the {@link Y.Doc} text
   * by replacing the entire buffer if necessary.
   * Avoids making an edit when contents already match. */
  private async initialSync(): Promise<void> {
    // Read `ytext` and set `initialSyncDone = true` synchronously
    // so that any remote delta arriving during the subsequent `applyEdit` is queued (not dropped)
    // and later applied on top of the new editor content.
    const ytextStr = this.ytext.toString()
    this.initialSyncDone = true
    const oldText = this.doc.getText()
    if (ytextStr === oldText) return
    const edit = new vs.WorkspaceEdit()
    const fullRange = new vs.Range(new vs.Position(0, 0), this.doc.positionAt(oldText.length))
    edit.replace(this.doc.uri, fullRange, ytextStr)
    await vs.workspace.applyEdit(edit)
  }

  private async applyDelta(delta: Y.YTextEvent['delta']): Promise<void> {
    const edit = new vs.WorkspaceEdit()
    let offset = 0
    for (const op of delta) {
      if (typeof op.retain === 'number') {
        offset += op.retain
      } else if (typeof op.delete === 'number') {
        edit.delete(this.doc.uri, new vs.Range(this.doc.positionAt(offset), this.doc.positionAt(offset + op.delete)))
        offset += op.delete
      } else if (typeof op.insert === 'string') {
        // Ignoring `op.insert : object | Y.AbstractType<any>`
        edit.insert(this.doc.uri, this.doc.positionAt(offset), op.insert)
      }
    }
    await vs.workspace.applyEdit(edit)
  }

  dispose() {
    const sel = this.collabServer.awareness.getLocalState()?.[AWARENESS_SELECTION_KEY] as AwarenessSelection | undefined
    if (sel?.filePath === this.doc.uri.fsPath) {
      this.collabServer.awareness.setLocalStateField(AWARENESS_SELECTION_KEY, null)
    }
    for (const d of this.disposables) d.dispose()
    this.disposables = []
    this.hs.destroy()
  }
}
