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

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Lean's `$/lean/fileProgress` payload; an empty `processing` list means the worker is idle. */
interface FileProgressParams {
  textDocument?: { uri?: string }
  processing?: unknown[]
}

/** A live LSP session for one project view, reused across identifier lookups.
 *
 * It keeps the project's file open as context, so {@link lookup} resolves identifiers the
 * project itself defines (not just Lean core), demonstrating that the project's own source
 * reaches `lake serve`. */
export class LeanLspSession {
  private ready: Promise<JsonRpcWebSocket> | undefined
  private opened = false
  private version = 0
  private readonly uri: string
  /** Resolvers waiting for the file worker to finish elaborating the latest text. */
  private idleWaiters: (() => void)[] = []

  constructor(
    private readonly path: string,
    private readonly projectDir: string,
    fileName: string,
    /** The project file's contents, used as the context every lookup elaborates against. */
    private readonly baseText: string,
  ) {
    this.uri = `file://${projectDir}${fileName}`
  }

  private connect(): Promise<JsonRpcWebSocket> {
    if (this.ready) return this.ready
    this.ready = (async () => {
      const client = await JsonRpcWebSocket.connect(this.path, (method, params) => {
        if (method !== '$/lean/fileProgress') return
        const p = params as FileProgressParams
        if (p.textDocument?.uri === this.uri && (p.processing?.length ?? 0) === 0) {
          this.idleWaiters.splice(0).forEach(resolve => resolve())
        }
      })
      const rootUri = `file://${this.projectDir.replace(/\/$/, '')}`
      await client.request('initialize', {
        processId: null,
        rootUri,
        capabilities: {},
        workspaceFolders: [{ uri: rootUri, name: 'project' }],
      })
      client.notify('initialized', {})
      return client
    })()
    return this.ready
  }

  /** Look up `identifier` in the project's context, returning the LSP's hover text
   * (type plus docstring), or `null` if it resolves to nothing. */
  async lookup(identifier: string): Promise<string | null> {
    const client = await this.connect()

    const base = this.baseText.endsWith('\n') ? this.baseText : this.baseText === '' ? '' : this.baseText + '\n'
    const checkLine = base.split('\n').length - 1
    const text = `${base}#check ${identifier.replace(/\s+/g, ' ').trim()}\n`
    const version = ++this.version

    // Register the idle waiter before sending, so a fast worker can't finish before we listen.
    const idle = new Promise<void>(resolve => this.idleWaiters.push(resolve))
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

    // `#check <id>` places the identifier at character 7, just past "#check ", on the last line.
    const position = { line: checkLine, character: 7 }
    const worker = { idle: false }
    void idle.then(() => (worker.idle = true))
    const deadline = Date.now() + 30_000
    for (;;) {
      const hover = await client.request<{ contents: unknown } | null>('textDocument/hover', {
        textDocument: { uri: this.uri },
        position,
      })
      const info = hover && hoverText(hover.contents).trim()
      if (info) return info
      // Elaboration done and still no hover ⇒ the identifier is unknown here.
      if (worker.idle || Date.now() > deadline) return null
      await delay(300)
    }
  }

  close(): void {
    void this.ready?.then(client => client.close())
  }
}
