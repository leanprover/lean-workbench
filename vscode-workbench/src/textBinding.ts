import vs from 'vscode'
import * as Y from 'yjs'
import { RemoteDocManager } from './remoteDoc'
import { YTEXT_KEY } from './util'

export function registerTextDocumentBindings(
  ctx: vs.ExtensionContext,
  docs: RemoteDocManager,
  log: vs.LogOutputChannel,
) {
  const bindings = new Map<string, Promise<YTextBinding>>()
  const onDidOpenTextDocument = (doc: vs.TextDocument) => {
    if (doc.uri.scheme !== 'file') return
    console.log(`did open ${JSON.stringify(doc.uri)}`)
    const filePath = doc.uri.fsPath
    // TODO: can one path have multiple `TextDocument`s?
    if (bindings.has(filePath)) return
    const remoteDoc = docs.ensureDoc(filePath)
    bindings.set(
      filePath,
      remoteDoc.then(rd => new YTextBinding(doc, rd, log)),
    )
  }
  const onDidCloseTextDocument = async (doc: vs.TextDocument) => {
    if (doc.uri.scheme !== 'file') return
    const filePath = doc.uri.fsPath
    const entry = bindings.get(filePath)
    if (!entry) return
    bindings.delete(filePath)
    void entry.then(hp => {
      hp.dispose()
    })
  }
  const onDidChangeTextDocument = (e: vs.TextDocumentChangeEvent) => {
    if (e.document.uri.scheme !== 'file') return
    const filePath = e.document.uri.fsPath
    const entry = bindings.get(filePath)
    if (!entry) {
      log.warn(`[onDidChangeTextDocument] Dropped edit on '${filePath}', missing YTextBinding`)
      return
    }
    entry.then(hp => {
      hp.onLocalChange(e)
    })
  }
  ctx.subscriptions.push(
    vs.workspace.onDidOpenTextDocument(onDidOpenTextDocument),
    vs.workspace.onDidCloseTextDocument(onDidCloseTextDocument),
    vs.workspace.onDidChangeTextDocument(onDidChangeTextDocument),
    {
      dispose() {
        for (const b of bindings.values()) {
          b.then(hp => {
            hp.dispose()
          })
        }
        bindings.clear()
      },
    },
  )
  // Bind already-open buffers
  for (const doc of vs.workspace.textDocuments) onDidOpenTextDocument(doc)

  return docs
}

/** Bidirectional binding between a `vs.TextDocument` and a `Y.Doc`. */
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
