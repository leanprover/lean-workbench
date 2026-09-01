/** Browser-side Lean LSP client.
 *
 * Talks to a `lake serve` process bridged to a WebSocket by {@link LeanLspHandle}.
 * Each WebSocket frame carries one JSON-RPC message (the bridge adds/strips the
 * `Content-Length` stdio framing), so this is a thin hand-rolled JSON-RPC client:
 * no `monaco`, no `vscode-languageclient`. */

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

/** Minimal JSON-RPC 2.0 client over a WebSocket. */
export class JsonRpcWebSocket {
  private nextId = 1
  private pending = new Map<number, Pending>()

  private constructor(
    private readonly ws: WebSocket,
    /** Invoked for server-initiated notifications (id-less messages). */
    private readonly onNotify: (method: string, params: unknown) => void,
  ) {}

  /** Resolves once the socket is open. */
  static connect(
    path: string,
    onNotify: (method: string, params: unknown) => void = () => {},
  ): Promise<JsonRpcWebSocket> {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${scheme}://${location.host}${path}`)
    const client = new JsonRpcWebSocket(ws, onNotify)
    ws.onmessage = ev => client.onMessage(String(ev.data))
    // A closed socket (e.g. the per-connection `lake serve` exited) can never answer; fail
    // in-flight requests rather than let them hang, since there is no per-request timeout.
    ws.onclose = () => client.rejectPending(new Error(`WebSocket to ${path} closed`))
    return new Promise((resolve, reject) => {
      ws.onopen = () => resolve(client)
      ws.onerror = () => reject(new Error(`WebSocket to ${path} failed`))
    })
  }

  get isOpen(): boolean {
    return this.ws.readyState === WebSocket.OPEN
  }

  private rejectPending(error: unknown) {
    for (const p of this.pending.values()) p.reject(error)
    this.pending.clear()
  }

  private onMessage(data: string) {
    const msg = JSON.parse(data) as {
      id?: number
      method?: string
      params?: unknown
      result?: unknown
      error?: { message?: string }
    }
    if (typeof msg.id !== 'number') {
      // Server-initiated notification (e.g. diagnostics, file progress); the caller drives requests.
      if (typeof msg.method === 'string') this.onNotify(msg.method, msg.params)
      return
    }
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error.message ?? 'JSON-RPC error'))
    else p.resolve(msg.result)
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  notify(method: string, params?: unknown): void {
    this.ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }))
  }

  close(): void {
    this.ws.close()
  }
}

/** LSP `Hover.contents` is one of several shapes; reduce it to plain text. */
function hoverText(contents: unknown): string {
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) return contents.map(hoverText).join('\n')
  if (contents && typeof contents === 'object' && 'value' in contents) {
    return String(contents.value)
  }
  return ''
}

/** A Lean LSP session for one project view, reused across identifier lookups.
 *
 * It keeps the project's file open as context, so {@link lookup} resolves identifiers the
 * project itself defines (not just Lean core), demonstrating that the project's own source
 * reaches `lake serve`.
 *
 * The connection self-heals: if the socket is not open when a lookup runs (e.g. it was closed
 * while the page sat in the back/forward cache), it reconnects and reloads the context, so a
 * lookup behaves like a fresh page without a manual reload. */
export class LeanLspSession {
  private client: JsonRpcWebSocket | undefined
  private connecting: Promise<JsonRpcWebSocket> | undefined
  private opened = false
  private version = 0
  private baseText = ''
  private readonly uri: string

  constructor(
    private readonly path: string,
    private readonly projectDir: string,
    fileName: string,
    /** Fetches the current context file contents; called afresh on every (re)connect. */
    private readonly loadContext: () => Promise<string>,
  ) {
    this.uri = `file://${projectDir}${fileName}`
  }

  private async open(): Promise<JsonRpcWebSocket> {
    const [client, baseText] = await Promise.all([JsonRpcWebSocket.connect(this.path), this.loadContext()])
    this.baseText = baseText
    const rootUri = `file://${this.projectDir.replace(/\/$/, '')}`
    await client.request('initialize', {
      processId: null,
      rootUri,
      capabilities: {},
      workspaceFolders: [{ uri: rootUri, name: 'project' }],
    })
    client.notify('initialized', {})
    this.client = client
    this.opened = false
    return client
  }

  private ensureClient(): Promise<JsonRpcWebSocket> {
    if (this.client?.isOpen) return Promise.resolve(this.client)
    this.connecting ??= this.open().finally(() => (this.connecting = undefined))
    return this.connecting
  }

  /** Look up `identifier` in the project's context, returning the LSP's hover text
   * (type plus docstring), or `null` if it resolves to nothing. */
  async lookup(identifier: string): Promise<string | null> {
    const client = await this.ensureClient()

    const base = this.baseText.endsWith('\n') ? this.baseText : this.baseText === '' ? '' : this.baseText + '\n'
    const checkLine = base.split('\n').length - 1
    const text = `${base}#check ${identifier.replace(/\s+/g, ' ').trim()}\n`
    const version = ++this.version

    if (this.opened) {
      client.notify('textDocument/didChange', {
        textDocument: { uri: this.uri, version },
        contentChanges: [{ text }],
      })
    } else {
      client.notify('textDocument/didOpen', {
        textDocument: { uri: this.uri, languageId: 'lean4', version, text },
      })
      this.opened = true
    }

    // Answers once every diagnostic for `version` or later has been emitted,
    // so the hover below reads a fully elaborated document.
    // Note the bare `uri`: these params are not a `TextDocumentIdentifier`.
    await client.request('textDocument/waitForDiagnostics', { uri: this.uri, version })

    // `#check <id>` places the identifier at character 7, just past "#check ", on the last line.
    const hover = await client.request<{ contents: unknown } | null>('textDocument/hover', {
      textDocument: { uri: this.uri },
      position: { line: checkLine, character: 7 },
    })
    const info = hover ? hoverText(hover.contents).trim() : ''
    return info === '' ? null : info
  }

  close(): void {
    this.client?.close()
  }
}
