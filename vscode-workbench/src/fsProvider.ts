import path from 'node:path'
import vs from 'vscode'

// https://code.visualstudio.com/api/extension-guides/virtual-documents
export class WorkbenchFileSystemProvider implements vs.FileSystemProvider {
  private onDidChangeFileEmitter = new vs.EventEmitter<vs.FileChangeEvent[]>()
  onDidChangeFile = this.onDidChangeFileEmitter.event

  constructor(
    /** Base path of the project on disk. */
    readonly basePath: string,
  ) {}

  /** Convert a `wrkbnch:` URI to a `file:` URI. */
  private toDiskUri(uri: vs.Uri): vs.Uri {
    const filePath = path.normalize(uri.fsPath)
    if (!`${filePath}/`.startsWith(this.basePath)) {
      throw vs.FileSystemError.NoPermissions(uri)
    }
    return vs.Uri.file(filePath)
  }

  // Operations that touch single files go through collab-server

  watch(): vs.Disposable {
    throw new Error('TODO watch')
  }

  async stat(uri: vs.Uri): Promise<vs.FileStat> {
    // TODO: stat from Yjs
    return vs.workspace.fs.stat(this.toDiskUri(uri))
  }

  async readFile(uri: vs.Uri): Promise<Uint8Array> {
    // TODO: prefer reads from Yjs
    return vs.workspace.fs.readFile(this.toDiskUri(uri))
  }

  async writeFile(
    uri: vs.Uri,
    content: Uint8Array,
    options: { readonly create: boolean; readonly overwrite: boolean },
  ): Promise<void> {
    const existed = await this.stat(this.toDiskUri(uri)).then(
      () => true,
      () => false,
    )
    if (!existed && !options.create) throw vs.FileSystemError.FileNotFound(uri)
    if (existed && options.create && !options.overwrite) throw vs.FileSystemError.FileExists(uri)
    throw new Error('TODO writeFile')
    this.onDidChangeFileEmitter.fire([{ type: existed ? vs.FileChangeType.Changed : vs.FileChangeType.Created, uri }])
  }

  // Filesystem operations go through the filesystem

  async readDirectory(uri: vs.Uri): Promise<[string, vs.FileType][]> {
    return vs.workspace.fs.readDirectory(this.toDiskUri(uri))
  }

  async createDirectory(uri: vs.Uri): Promise<void> {
    await vs.workspace.fs.createDirectory(this.toDiskUri(uri))
    this.onDidChangeFileEmitter.fire([{ type: vs.FileChangeType.Created, uri }])
  }

  async delete(uri: vs.Uri, options: { readonly recursive: boolean }): Promise<void> {
    await vs.workspace.fs.delete(this.toDiskUri(uri), options)
    this.onDidChangeFileEmitter.fire([{ type: vs.FileChangeType.Deleted, uri }])
  }

  async rename(oldUri: vs.Uri, newUri: vs.Uri, options: { readonly overwrite: boolean }): Promise<void> {
    await vs.workspace.fs.rename(this.toDiskUri(oldUri), this.toDiskUri(newUri), options)
    this.onDidChangeFileEmitter.fire([
      { type: vs.FileChangeType.Deleted, uri: oldUri },
      { type: vs.FileChangeType.Created, uri: newUri },
    ])
  }
}
