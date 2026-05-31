import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import path from 'node:path'
import vs from 'vscode'
import * as Y from 'yjs'
import { Logger, logWithPrefix, YTEXT_KEY } from './util'

/** Maintains a {@link YTextBinding} binding for every open {@link vs.TextDocument}
 * whose path lies within one of the syncable directories. */
export class YTextBindingManager implements vs.Disposable {
  private bindings = new Map<string, YTextBinding>()
  private disposables: vs.Disposable[] = []

  constructor(
    private readonly collabSock: HocuspocusProviderWebsocket,
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
    this.bindings.set(filePath, new YTextBinding(doc, this.collabSock, this.log))
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

  dispose() {
    for (const d of this.disposables) d.dispose()
    this.disposables = []
    for (const b of this.bindings.values()) b.dispose()
    this.bindings.clear()
  }
}

/** Common interface between {@link vs.TextEditorEdit} and {@link vs.WorkspaceEdit}. */
interface EditBuilder {
  insert(location: vs.Position, newText: string): void
  delete(location: vs.Range): void
  replace(range: vs.Range, newText: string): void
}

/** Bidirectional binding between a {@link vs.TextDocument}
 * and the {@link Y.Text} of a {@link HocuspocusProvider}.
 *
 * WARNING: Unlike Monaco, VSCode has no API for synchronous edits.
 * This binding is correspondingly much more subtle than Y-Monaco.
 * When a remote change comes in,
 * we repeatedly attempt to apply it as an asynchronous edit;
 * an attempt may fail if a local change is made in the meantime.
 * To compute the correct edit w.r.t. the current document contents,
 * we diff the `remoteYtext` that contains remote changes
 * against our `localYtext` that matches the VSCode-managed `doc`. */
export class YTextBinding implements vs.Disposable {
  private readonly hs: HocuspocusProvider

  /** Public for tests only. */
  get remoteYtext(): Y.Text {
    return this.hs.document.getText(YTEXT_KEY)
  }

  /** The CRDT that we base remote diffs on (see comment above).
   * - Defined from initial sync onwards.
   * - Inbetween {@link mutex}-guarded transactions,
   *   its contents must match those of {@link doc}.
   * - Includes a subset of the updates seen by {@link hs}. */
  private localYdoc: Y.Doc | undefined

  /** True once we have received an initial remote doc from the collab-server.
   * Public for tests only. */
  get initialSyncDone(): boolean {
    return !!this.localYdoc
  }

  private get localYtext(): Y.Text {
    return this.localYdoc!.getText(YTEXT_KEY)
  }

  private ensureSyncTimeout: NodeJS.Timeout | undefined

  /** Used to linearize and order async operations
   * that temporarily create inconsistent states while suspended. */
  private mutex: Promise<void> = Promise.resolve()

  private readonly log: Logger

  constructor(
    readonly doc: vs.TextDocument,
    collabSock: HocuspocusProviderWebsocket,
    log_: Logger,
    /** Name of this document in {@link collabSock}.
     * Expected to be the file path except in tests. */
    docName: string = doc.uri.fsPath,
    /** Whether to enable the {@link scheduleEnsureSync} fallback.
     * Expected to be `true` except in tests. */
    readonly enableEnsureSync: boolean = true,
  ) {
    // https://tiptap.dev/docs/hocuspocus/provider/examples#multiplexing
    this.hs = new HocuspocusProvider({
      websocketProvider: collabSock,
      name: docName,
      // We use a single, global awareness CRDT rather than per-document CRDTs.
      awareness: null,
    })
    this.hs.attach()

    this.log = logWithPrefix(log_, `[YTextBinding(${docName}|${this.hs.document.clientID.toString(16)})]`)

    this.remoteYtext.observe(this.onRemoteUpdate)

    const onLaterSync = () => {
      this.log.warn(`unexpected reconnection from collab-server`)
    }
    if (this.hs.synced) {
      this.enqueueTransaction(() => this.initFromRemote())
      this.hs.on('synced', onLaterSync)
    } else {
      const onInitialSync = () => {
        this.hs.off('synced', onInitialSync)
        this.enqueueTransaction(() => this.initFromRemote())
        this.hs.on('synced', onLaterSync)
      }
      this.hs.on('synced', onInitialSync)
    }
  }

  /** Place an operation on the work queue.
   * Work items are atomic w.r.t. all other work items
   * (but not w.r.t. other `async` operations). */
  private enqueueTransaction(work: () => Promise<void>): void {
    this.mutex = this.mutex.then(work).catch(e => {
      this.log.error(e)
    })
  }

  /** Attempt to make a local edit. Return `true` iff successful. */
  private async makeLocalEdit(fn: (_: EditBuilder) => void): Promise<boolean> {
    const MAX_EDITOR_RETRIES = 10
    const MAX_WORKSPACE_RETRIES = 10

    /** First try {@link vs.TextEditor.edit}.
     * Preferrable because it has a version guard:
     * `fn` runs with a given {@link vs.TextDocument.version}
     * and the resulting edit is rejected if the doc moves in the meantime,
     * guaranteeing correct offsets.
     * Needs the document to be open in a visible editor. */
    for (let i = 0; i < MAX_EDITOR_RETRIES; i++) {
      let hasEditor = false
      for (const e of vs.window.visibleTextEditors) {
        if (e.document === this.doc) {
          hasEditor = true
          const success = await e.edit(fn)
          if (success) {
            this.log.trace('[makeLocalEdit] used TextEditor.edit')
            return true
          }
        }
      }
      if (!hasEditor) break
    }

    /** Then try {@link vs.WorkspaceEdit}.
     * No version guard so can't handle concurrent local edits,
     * but generally only runs if the document is not being actively edited
     * (except for very rare races with programmatic edits). */
    for (let i = 0; i < MAX_WORKSPACE_RETRIES; i++) {
      const edit = new vs.WorkspaceEdit()
      fn({
        insert: (l, t) => edit.insert(this.doc.uri, l, t),
        delete: r => edit.delete(this.doc.uri, r),
        replace: (r, t) => edit.replace(this.doc.uri, r, t),
      })
      const success = await vs.workspace.applyEdit(edit)
      if (success) {
        this.log.trace('[makeLocalEdit] used workspace.applyEdit')
        return true
      }
    }
    return false
  }

  /** (Re)initialize {@link localYdoc} and {@link doc} with the remote text,
   * replacing the entire {@link doc} buffer if necessary.
   * Avoids making an edit when contents already match. */
  private async initFromRemote(): Promise<void> {
    if (this.localYdoc) {
      this.localYdoc.off('update', this.onLocalUpdate)
      this.localYdoc.destroy()
    }
    this.localYdoc = new Y.Doc()
    Y.applyUpdate(this.localYdoc, Y.encodeStateAsUpdate(this.hs.document))
    this.localYdoc.on('update', this.onLocalUpdate)

    const remoteStr = this.remoteYtext.toString()
    const localStr = this.doc.getText()
    let success = false
    if (remoteStr === localStr) {
      success = true
    } else {
      success = await this.makeLocalEdit(b => {
        const fullRange = new vs.Range(new vs.Position(0, 0), this.doc.positionAt(this.doc.getText().length))
        b.replace(fullRange, remoteStr)
      })
    }
    if (success) {
      this.log.trace('[initFromRemote] synced')
    } else {
      this.log.error(`[initFromRemote] failed to overwrite document`)
    }
  }

  private onRemoteUpdate = (_: Y.YTextEvent, transaction: Y.Transaction) => {
    // First check prevents bounceback (https://beta.yjs.dev/docs/api/transactions/#the-origin-concept).
    // Second ignores remote deltas before remote doc has been received.
    if (transaction.origin === this || !this.initialSyncDone) return
    this.scheduleMergeRemoteDiff()
  }

  /** Event handler for `this.localYDoc.on('update')`. */
  private onLocalUpdate = (update: Uint8Array, origin: unknown) => {
    // On the local doc, `origin === this` means *do broadcast*.
    if (origin !== this || !this.initialSyncDone) return

    /** Apply this broadcastable local change to the remote doc.
     * Crucial to make edits on local Y.doc in {@link onLocalChange} and propagate the update to remote
     * rather than the other way around:
     * in general, remote has seen more updates than local,
     * so an update generated on the remote CRDT may have overly recent clocks,
     * thus being stashed in the local doc's `pendingStructs`
     * rather than being immediately applied.
     * This would lead it to produce deltas duplicating local changes in {@link mergeRemoteDiff}. */
    Y.applyUpdate(this.hs.document, update, this)
  }

  onLocalChange(e: vs.TextDocumentChangeEvent): void {
    if (e.document !== this.doc) throw new Error('internal error: received event for wrong document')
    if (!this.initialSyncDone || e.contentChanges.length === 0) return
    if (!e.detailedReason) throw new Error('internal error: textDocumentChangeReason API proposal is disabled')
    // File re-read from disk
    if (e.detailedReason.source === 'reloadFromDisk') {
      // Prefer CRDT state to on-disk contents
      this.scheduleEnsureSync()
      return
    }
    /** Prevent loopback by checking for the two methods of editing used in {@link makeLocalEdit}. */
    if (
      e.detailedReason.source === 'unknown' &&
      e.detailedReason.metadata.source === 'unknown' &&
      (!e.detailedReason.metadata.name /* workspace.applyEdit */ ||
        e.detailedReason.metadata.name === 'pushEditOperation' /* workspace.applyEdit */ ||
        e.detailedReason.metadata.name === 'MainThreadTextEditor') /* TextEditor.edit */
    ) {
      // TODO these checks are *incomplete*:
      // we must not broadcast our applications of remote changes
      // (since that would cause an infinite broadcast loop),
      // but we should broadcast programmatic edits from other extensions
      // (notably Vim and VSCode Neovim).
      // However, there is no VSCode API to set the `detailedReason`,
      // or any other field of the resulting `TextDocumentChangeEvent`,
      // and checking document versions or edit content
      // turned out prone to a number of race conditions.
      // The only viable fix seems to be patching `openvscode-server`
      // to support setting `detailedReason.source` on our own edits.
      // For now, {@link scheduleEnsureSync} reverts unbroadcasted local changes.
      this.scheduleEnsureSync()
      return
    }

    this.log.trace(
      `[onLocalChange] broadcasting ${JSON.stringify(e.contentChanges.map(c => [c.rangeOffset, c.rangeLength, c.text]))} (detailed reason ${JSON.stringify(e.detailedReason)})`,
    )

    /** Apply the broadcastable local change to {@link localYdoc} with `this` origin.
     * (Remote changes are applied to {@link localYdoc} in {@link mergeRemoteDiff}.) */
    this.localYdoc!.transact(() => {
      // VSCode sorts `contentChanges` in reverse offset order
      // so they can be applied sequentially without offset adjustment.
      for (const ch of e.contentChanges) {
        if (ch.rangeLength) this.localYtext.delete(ch.rangeOffset, ch.rangeLength)
        if (ch.text) this.localYtext.insert(ch.rangeOffset, ch.text)
      }
    }, this)
    this.scheduleEnsureSync()
  }

  /** Whether a run of {@link mergeRemoteDiff} is already scheduled.
   * Used to avoid running many redundant merges with empty deltas. */
  private mergeRemoteDiffScheduled: boolean = false

  private scheduleMergeRemoteDiff(): void {
    if (this.mergeRemoteDiffScheduled) return
    this.enqueueTransaction(() => this.mergeRemoteDiff())
    this.mergeRemoteDiffScheduled = true
  }

  private async mergeRemoteDiff(): Promise<void> {
    this.mergeRemoteDiffScheduled = false
    let update: Uint8Array | undefined
    const mkEdits = (b: EditBuilder) => {
      // Observe the delta by updating a fresh Y.Doc
      // (there is no way to compute a delta from an update directly).
      const fork = new Y.Doc()
      Y.applyUpdate(fork, Y.encodeStateAsUpdate(this.localYdoc!))
      // Yjs fires observers synchronously, thus populating `delta`, during `applyUpdate`.
      let delta: Y.YTextEvent['delta'] = []
      fork.getText(YTEXT_KEY).observe(e => {
        delta = e.delta
      })
      update = Y.encodeStateAsUpdate(this.hs.document)
      Y.applyUpdate(fork, update)
      fork.destroy()
      if (delta.length === 0) return

      this.log.trace(`[mergeRemoteDiff] applying delta ${JSON.stringify(delta)}`)
      let offset = 0
      for (const op of delta) {
        if (typeof op.retain === 'number') {
          offset += op.retain
        } else if (typeof op.delete === 'number') {
          b.delete(new vs.Range(this.doc.positionAt(offset), this.doc.positionAt(offset + op.delete)))
          offset += op.delete
        } else if (typeof op.insert === 'string') {
          // Ignoring `op.insert : object | Y.AbstractType<any>`
          b.insert(this.doc.positionAt(offset), op.insert)
        }
      }
    }

    const success = await this.makeLocalEdit(mkEdits)
    if (success) {
      if (!update) throw new Error('[mergeRemoteDiff] internal error: edit succeeded but update missing')
      // Edit is now included in `doc`, update `localYdoc` to match.
      Y.applyUpdate(this.localYdoc!, update)
    } else {
      this.log.warn(`[mergeRemoteDiff] edit failed, dropping update`)
    }
    this.scheduleEnsureSync()
  }

  /** Ensure that {@link localYdoc} has the same contents as {@link doc},
   * and that {@link localYdoc} and {@link hs} have the same CRDT state.
   * Overwrite {@link localYdoc} and {@link doc} if this is not the case.
   * Debounced - runs 3s after the most recent invocation. */
  private scheduleEnsureSync() {
    if (!this.initialSyncDone || !this.enableEnsureSync) return
    if (this.ensureSyncTimeout) clearTimeout(this.ensureSyncTimeout)
    this.ensureSyncTimeout = setTimeout(() => {
      this.enqueueTransaction(async () => {
        const localYtextStr = this.localYtext.toString()
        const docStr = this.doc.getText()
        if (docStr !== localYtextStr) {
          this.log.debug('[ensureSync] doc<->localYdoc desync, overwriting')
          await this.initFromRemote()
          return
        }
        const sl = Y.encodeStateVector(this.localYdoc!)
        const sr = Y.encodeStateVector(this.hs.document)
        if (sl.length !== sr.length || !sl.every((b, i) => b === sr[i])) {
          this.log.debug('[ensureSync] remoteYdoc<->localYdoc desync, overwriting')
          await this.initFromRemote()
        }
      })
    }, 3_000)
  }

  dispose() {
    clearTimeout(this.ensureSyncTimeout)

    this.localYdoc?.off('update', this.onLocalUpdate)
    this.localYdoc?.destroy()

    this.remoteYtext.unobserve(this.onRemoteUpdate)
    this.hs.destroy()
  }
}
