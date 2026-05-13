import path from 'node:path'
import vs from 'vscode'
import * as Y from 'yjs'
import { RemoteDocManager } from './remoteDoc'
import { YTEXT_KEY } from './util'

/** Maintains a {@link YTextBinding} binding for every open {@link vs.TextDocument}
 * whose path lies within one of the syncable directories. */
export class YTextBindingManager implements vs.Disposable {
  private bindings = new Map<string, Promise<YTextBinding | undefined>>()
  private disposables: vs.Disposable[] = []

  constructor(
    private readonly docs: RemoteDocManager,
    /** Directories to sync. Files not contained in any of these are not synced. */
    private syncDirs: string[],
    private readonly log: vs.LogOutputChannel,
  ) {
    this.disposables.push(
      vs.workspace.onDidOpenTextDocument(doc => this.onDidOpenTextDocument(doc)),
      vs.workspace.onDidCloseTextDocument(doc => this.onDidCloseTextDocument(doc)),
      vs.workspace.onDidChangeTextDocument(e => this.onDidChangeTextDocument(e)),
    )
    // Bind already-open buffers
    for (const doc of vs.workspace.textDocuments) this.onDidOpenTextDocument(doc)
  }

  /** Replace the set of syncable directories. */
  updateSyncableDirs(syncDirs: string[]) {
    this.syncDirs = syncDirs
    // Tear down bindings no longer in any syncable dir
    for (const [filePath, entry] of this.bindings) {
      if (this.shouldSyncPath(filePath)) continue
      this.bindings.delete(filePath)
      void entry.then(hp => hp?.dispose())
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
    const remoteDoc = this.docs.ensureDoc(filePath)
    const promise = remoteDoc
      .then(rd => new YTextBinding(doc, rd, this.log))
      .catch(err => {
        this.log.error(`[onDidOpenTextDocument] failed to initialize Yjs binding for '${filePath}': ${String(err)}`)
        if (this.bindings.get(filePath) === promise) this.bindings.delete(filePath)
        return undefined
      })
    this.bindings.set(filePath, promise)
  }

  private onDidCloseTextDocument(doc: vs.TextDocument) {
    if (doc.uri.scheme !== 'file') return
    const filePath = doc.uri.fsPath
    const entry = this.bindings.get(filePath)
    if (!entry) return
    this.bindings.delete(filePath)
    void entry.then(hp => hp?.dispose())
  }

  private onDidChangeTextDocument(e: vs.TextDocumentChangeEvent) {
    if (e.document.uri.scheme !== 'file') return
    const filePath = e.document.uri.fsPath
    const entry = this.bindings.get(filePath)
    if (!entry) {
      if (this.shouldSyncPath(filePath)) {
        this.log.warn(`[onDidChangeTextDocument] dropped edit on '${filePath}', missing YTextBinding`)
      }
      return
    }
    void entry.then(hp => hp?.onLocalChange(e))
  }

  dispose() {
    for (const d of this.disposables) d.dispose()
    this.disposables = []
    for (const b of this.bindings.values()) void b.then(hp => hp?.dispose())
    this.bindings.clear()
  }
}

/** Bidirectional binding between a {@link vs.TextDocument} and a {@link Y.Doc}. */
export class YTextBinding implements vs.Disposable {
  private ytext: Y.Text
  /** Used to prevent `applyEdit` bounceback when applying remote changes;
   * when set, local `onDidChangeTextDocument` events are ignored. */
  // FIXME: try hard to hack through vscode and tag edit events. Would be much simpler.
  private applyingRemote = false
  /** Used to linearize async operations that might otherwise interleave. */
  private pending: Promise<void> = Promise.resolve()

  private disposables: { dispose(): unknown }[] = []

  /** May only be constructed with a `Y.Doc` whose provider has already `synced` at least once. */
  constructor(
    readonly doc: vs.TextDocument,
    readonly remoteDoc: Y.Doc,
    private readonly log: vs.LogOutputChannel,
  ) {
    this.ytext = remoteDoc.getText(YTEXT_KEY)

    // Overwrite with remote contents on startup.
    this.enqueue(() => this.replaceWithRemote())

    const observer = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      // Prevent bounceback (https://beta.yjs.dev/docs/api/transactions/#the-origin-concept).
      if (transaction.origin === this) return
      const delta = event.delta
      this.enqueue(() => this.applyDelta(delta))
    }
    this.ytext.observe(observer)
    this.disposables.push({
      dispose: () => {
        this.ytext.unobserve(observer)
      },
    })
  }

  /** Place an operation on the work queue.
   * Work items are atomic w.r.t. all other work items
   * (but not w.r.t. other `async` operations). */
  private enqueue(work: () => Promise<void>): void {
    this.pending = this.pending.then(work).catch(e => {
      this.log.error(`[YTextBinding(${this.doc.uri.fsPath})] ${String(e)}`)
    })
  }

  onLocalChange(e: vs.TextDocumentChangeEvent): void {
    // BUG 1: local edits that arrive while `applyingRemote` is set,
    //        if that is possible, are lost.
    //        would also linearizing `onLocalChange` help?
    if (this.applyingRemote) return
    if (e.document !== this.doc) return
    if (e.contentChanges.length === 0) return
    this.remoteDoc.transact(() => {
      // VSCode sorts `contentChanges` in reverse offset order
      // so they can be applied sequentially without offset adjustment.
      for (const ch of e.contentChanges) {
        if (ch.rangeLength) this.ytext.delete(ch.rangeOffset, ch.rangeLength)
        if (ch.text) this.ytext.insert(ch.rangeOffset, ch.text)
      }
    }, this)
  }

  private async applyDelta(delta: Y.YTextEvent['delta']): Promise<void> {
    const edit = new vs.WorkspaceEdit()
    let offset = 0
    for (const op of delta) {
      if (op.retain != null) {
        offset += op.retain
      } else if (op.delete != null) {
        edit.delete(this.doc.uri, new vs.Range(this.doc.positionAt(offset), this.doc.positionAt(offset + op.delete)))
        offset += op.delete
      } else if (typeof op.insert === 'string') {
        edit.insert(this.doc.uri, this.doc.positionAt(offset), op.insert)
      }
    }
    this.applyingRemote = true
    try {
      await vs.workspace.applyEdit(edit)
    } finally {
      this.applyingRemote = false
    }
  }

  /** Ensure that buffer contents match the Y.Doc text
   * by replacing the entire buffer if necessary.
   * Avoids making an edit when contents already match. */
  async replaceWithRemote() {
    const ytextStr = this.ytext.toString()
    if (ytextStr === this.doc.getText()) return
    const edit = new vs.WorkspaceEdit()
    const fullRange = new vs.Range(new vs.Position(0, 0), this.doc.positionAt(this.doc.getText().length))
    edit.replace(this.doc.uri, fullRange, ytextStr)
    this.applyingRemote = true
    try {
      await vs.workspace.applyEdit(edit)
    } finally {
      this.applyingRemote = false
    }
  }

  dispose() {
    for (const d of this.disposables) d.dispose()
  }
}
