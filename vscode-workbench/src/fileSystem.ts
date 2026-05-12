import path from 'node:path'
import vs from 'vscode'
import { RemoteDocManager } from './remoteDoc'
import { YTEXT_KEY } from './util'

// https://code.visualstudio.com/api/extension-guides/virtual-documents
export class WorkbenchFileSystemProvider implements vs.FileSystemProvider {
  constructor(
    /** Base path of the project on disk.
     * Only paths rooted here are accessible. */
    readonly basePath: string,
    private readonly docs: RemoteDocManager,
    private readonly log: vs.LogOutputChannel,
  ) {}

  /** Convert a `wrkbnch:` URI to a `file:` URI,
   * ensuring that it is accessible. */
  private checkedToFileUri(uri: vs.Uri): vs.Uri {
    const filePath = path.normalize(uri.fsPath)
    if (!`${filePath}/`.startsWith(this.basePath)) {
      throw vs.FileSystemError.NoPermissions(uri)
    }
    return vs.Uri.file(filePath)
  }

  // File watching

  private onDidChangeFileEmitter = new vs.EventEmitter<vs.FileChangeEvent[]>()
  onDidChangeFile = this.onDidChangeFileEmitter.event

  watch(): vs.Disposable {
    throw new Error('TODO watch')
  }

  /** Fire those events whose files are currently being watched. */
  private maybeFireOnDidChangeFile(events: vs.FileChangeEvent[]) {
    // TODO: filter
    // TODO: should remote changes fire this?
    // They don't cause FS-level changes in general; but we pretend that collab-server storage is the FS.
    this.onDidChangeFileEmitter.fire(events)
  }

  // File operations go through collab-server

  async stat(uri: vs.Uri): Promise<vs.FileStat> {
    const fileUri = this.checkedToFileUri(uri)
    const hp = await this.docs.getStartedDoc(fileUri.fsPath)
    const diskStat = await vs.workspace.fs.stat(fileUri).then(
      s => s,
      () => undefined,
    )
    if (hp) {
      const ytext = hp.document.getText(YTEXT_KEY)
      return {
        type: vs.FileType.File,
        // TODO: store time in Yjs
        ctime: diskStat?.ctime ?? Date.now(),
        mtime: diskStat?.mtime ?? Date.now(),
        size: Buffer.byteLength(ytext.toString(), 'utf-8'),
      }
    }
    if (!diskStat) throw vs.FileSystemError.FileNotFound(uri)
    return diskStat
  }

  async readFile(uri: vs.Uri): Promise<Uint8Array> {
    console.log(`awaiting file ${JSON.stringify(uri)}`)
    const doc = await this.docs.ensureDoc(this.checkedToFileUri(uri).fsPath)
    console.log(`got file ${JSON.stringify(uri)}`)
    const ytext = doc.getText(YTEXT_KEY)
    return new TextEncoder().encode(ytext.toString())
  }

  async writeFile(
    uri: vs.Uri,
    content: Uint8Array,
    options: { readonly create: boolean; readonly overwrite: boolean },
  ): Promise<void> {
    const exists = await this.stat(uri).then(
      () => true,
      () => false,
    )
    if (exists) {
      if (options.create && !options.overwrite) throw vs.FileSystemError.FileExists(uri)
      // FIXME: Assumes that the remote Y.Doc already has the correct contents! Compare?
      this.docs.saveDoc(this.checkedToFileUri(uri).fsPath)
    } else {
      if (!options.create) throw vs.FileSystemError.FileNotFound(uri)
      const parentUri = vs.Uri.joinPath(uri, '..')
      const parentExists = await this.stat(parentUri).then(
        () => true,
        () => false,
      )
      if (!parentExists) throw vs.FileSystemError.FileNotFound(parentUri)

      // Just write to filesystem; collab-server will pick up the contents automatically
      await vs.workspace.fs.writeFile(this.checkedToFileUri(uri), content)
    }
    this.maybeFireOnDidChangeFile([{ type: exists ? vs.FileChangeType.Changed : vs.FileChangeType.Created, uri }])
  }

  // Filesystem operations go through the filesystem

  // FIXME: This is not entirely consistent.
  // If a user removes a file that has a Y.Doc open,
  // readDirectory will no longer return it while readFile will still work.
  async readDirectory(uri: vs.Uri): Promise<[string, vs.FileType][]> {
    return vs.workspace.fs.readDirectory(this.checkedToFileUri(uri))
  }

  async createDirectory(uri: vs.Uri): Promise<void> {
    await vs.workspace.fs.createDirectory(this.checkedToFileUri(uri))
    this.maybeFireOnDidChangeFile([{ type: vs.FileChangeType.Created, uri }])
  }

  async delete(uri: vs.Uri, options: { readonly recursive: boolean }): Promise<void> {
    await vs.workspace.fs.delete(this.checkedToFileUri(uri), options)
    this.maybeFireOnDidChangeFile([{ type: vs.FileChangeType.Deleted, uri }])
  }

  async rename(oldUri: vs.Uri, newUri: vs.Uri, options: { readonly overwrite: boolean }): Promise<void> {
    await vs.workspace.fs.rename(this.checkedToFileUri(oldUri), this.checkedToFileUri(newUri), options)
    this.maybeFireOnDidChangeFile([
      { type: vs.FileChangeType.Deleted, uri: oldUri },
      { type: vs.FileChangeType.Created, uri: newUri },
    ])
  }
}
