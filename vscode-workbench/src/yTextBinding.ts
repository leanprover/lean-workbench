import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import vs from 'vscode'
import * as Y from 'yjs'
import { WORKBENCH_URI_SCHEME, YTEXT_KEY } from './util'

export type DocEntry = { provider: HocuspocusProvider; binding: YTextBinding }

export function registerYjsBindings(
  ctx: vs.ExtensionContext,
  log: vs.LogOutputChannel,
  collabSock: HocuspocusProviderWebsocket,
): Map<string, DocEntry> {
  const docs = new Map<string, DocEntry>()

  const onDidOpenTextDocument = (doc: vs.TextDocument) => {
    if (doc.uri.scheme !== WORKBENCH_URI_SCHEME) return
    const name = doc.uri.fsPath
    if (docs.has(name)) return
    // https://tiptap.dev/docs/hocuspocus/provider/examples#multiplexing
    const provider = new HocuspocusProvider({
      websocketProvider: collabSock,
      name,
      onSynced: data => log.trace(`[HocuspocusProvider] ${name} synced ${String(data.state)}`),
    })
    provider.attach()
    const binding = new YTextBinding(doc, provider, log)
    docs.set(name, { provider, binding })
  }
  const onDidCloseTextDocument = (doc: vs.TextDocument) => {
    const name = doc.uri.fsPath
    const entry = docs.get(name)
    if (!entry) return
    entry.binding.dispose()
    entry.provider.destroy()
    docs.delete(name)
  }
  const onDidChangeTextDocument = (e: vs.TextDocumentChangeEvent) => {
    if (e.document.uri.scheme !== WORKBENCH_URI_SCHEME) return
    const name = e.document.uri.fsPath
    const entry = docs.get(name)
    if (!entry) {
      log.warn(`[onDidChangeTextDocument] Dropped edit on '${name}', missing YTextBinding`)
      return
    }
    entry.binding.onLocalChange(e)
  }
  ctx.subscriptions.push(
    vs.workspace.onDidOpenTextDocument(onDidOpenTextDocument),
    vs.workspace.onDidCloseTextDocument(onDidCloseTextDocument),
    vs.workspace.onDidChangeTextDocument(onDidChangeTextDocument),
    {
      dispose() {
        for (const { provider, binding } of docs.values()) {
          binding.dispose()
          provider.destroy()
        }
        docs.clear()
      },
    },
  )
  // Bind already-open buffers
  for (const doc of vs.workspace.textDocuments) onDidOpenTextDocument(doc)

  return docs
}

/** Bidirectional binding between a `vs.TextDocument` and the `Y.Text` of a Hocuspocus document. */
export class YTextBinding implements vs.Disposable {
  private ytext: Y.Text
  /** Used to prevent `applyEdit` bounceback when applying remote changes;
   * when set, local `onDidChangeTextDocument` events are ignored. */
  private applyingRemote = false
  private initialSyncDone = false
  /** Used to linearize async operations that might otherwise interleave. */
  private pending: Promise<void> = Promise.resolve()

  private disposables: { dispose(): unknown }[] = []

  constructor(
    readonly doc: vs.TextDocument,
    readonly hs: HocuspocusProvider,
    private readonly log: vs.LogOutputChannel,
  ) {
    this.ytext = hs.document.getText(YTEXT_KEY)

    const observer = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      // First check prevents bounceback (https://beta.yjs.dev/docs/api/transactions/#the-origin-concept).
      // Second ignores remote deltas before we see the full remote doc.
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

    if (hs.synced) {
      this.enqueue(() => this.initialSync())
    } else {
      const onSynced = () => {
        hs.off('synced', onSynced)
        this.enqueue(() => this.initialSync())
      }
      hs.on('synced', onSynced)
      this.disposables.push({
        dispose: () => {
          hs.off('synced', onSynced)
        },
      })
    }
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
    if (this.applyingRemote || !this.initialSyncDone) return
    if (e.document !== this.doc) return
    if (e.contentChanges.length === 0) return
    this.hs.document.transact(() => {
      // VSCode sorts `contentChanges` in reverse offset order
      // so they can be applied sequentially without offset adjustment.
      for (const ch of e.contentChanges) {
        if (ch.rangeLength) this.ytext.delete(ch.rangeOffset, ch.rangeLength)
        if (ch.text) this.ytext.insert(ch.rangeOffset, ch.text)
      }
    }, this)
  }

  /** Reconcile the editor with `Y.Text` once the initial sync has completed.
   * Order matters: read `ytext` and set `initialSyncDone = true` synchronously
   * so that any remote delta arriving during the subsequent `applyEdit` is queued (not dropped)
   * and later applied on top of the new editor content. */
  private async initialSync(): Promise<void> {
    const ytextStr = this.ytext.toString()
    this.initialSyncDone = true
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

  dispose() {
    for (const d of this.disposables) d.dispose()
  }
}
