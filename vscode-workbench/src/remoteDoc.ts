import { HocuspocusProvider, type HocuspocusProviderWebsocket, type onSyncedParameters } from '@hocuspocus/provider'
import vs from 'vscode'
import * as Y from 'yjs'

/** Manages per-doc connections to `collab-server`.
 * We refer to collaborative text buffers as 'docs', matching Yjs's `Y.Doc`.
 * Docs are addressed by file paths but exist in `collab-server`'s memory.
 * Docs can be open despite not having an underlying file
 * (e.g. when one person removes a file that others still have open).
 * They are only written to the filesystem when users save. */
export class RemoteDocManager implements vs.Disposable {
  /** absolute path ↦ remote doc connection */
  private hpPromises = new Map<string, Promise<HocuspocusProvider>>()

  constructor(
    private readonly collabSock: HocuspocusProviderWebsocket,
    private readonly log: vs.LogOutputChannel,
  ) {}

  /** Return the remote connection if one has already been started for the given file path.
   * Waits for initial sync but does not initiate a new connection. */
  async getStartedDoc(filePath: string): Promise<HocuspocusProvider | undefined> {
    return this.hpPromises.get(filePath)
  }

  /** Return the remote connection for the given file path.
   * Waits for initial sync of buffer contents before returning. */
  // TODO: when do we close a remote doc? `onDidCloseTextDocument`?
  async ensureDoc(filePath: string): Promise<Y.Doc> {
    let p = this.hpPromises.get(filePath)
    if (!p) {
      p = new Promise<HocuspocusProvider>((resolve, reject) => {
        // https://tiptap.dev/docs/hocuspocus/provider/examples#multiplexing
        const hp = new HocuspocusProvider({
          websocketProvider: this.collabSock,
          name: filePath,
        })
        const timer = setTimeout(() => {
          hp.destroy()
          if (this.hpPromises.get(filePath) === p) this.hpPromises.delete(filePath)
          reject(new Error(`[HocuspocusProvider] '${filePath}' timed out before initial sync`))
        }, 3_000)
        const onInitialSync = (data?: onSyncedParameters) => {
          clearTimeout(timer)
          hp.off('synced', onInitialSync)
          this.log.trace(`[HocuspocusProvider] '${filePath}' synced ${data ? String(data.state) : ''}`)
          resolve(hp)
        }
        if (hp.synced) onInitialSync()
        else hp.on('synced', onInitialSync)
        hp.attach()
      })
      this.hpPromises.set(filePath, p)
    }
    return (await p).document
  }

  /** Signal `collab-server` to save the contents of the given doc. */
  async saveDoc(filePath: string) {
    const p = this.hpPromises.get(filePath)
    if (!p) return
    const hp = await p
    hp.sendStateless(JSON.stringify({ action: 'save' }))
  }

  dispose() {
    for (const p of this.hpPromises.values()) {
      void p.then(hp => hp.destroy()).catch(() => {})
    }
    this.hpPromises.clear()
  }
}
