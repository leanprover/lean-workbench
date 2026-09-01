import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

import { bwrapProjectDir } from '@leanprover/workbench-shared'
import { getElanDir, getUserHomeDir } from '@leanprover/workbench-shared/node'
import { type WebSocket, WebSocketServer } from 'ws'

import { type User } from '@/lib/server/auth'
import { BWRAP_ARGS, bwrapHomeDir } from '@/lib/server/util'
import { type Project } from '@/prisma/generated/client'

/** Name of the LSP bridge UDS file. */
const LSP_SOCKET_FILENAME = 'lsp.sock'

/** Bridge a WebSocket to a `lake serve` child's stdio.
 *
 * The browser exchanges one JSON-RPC message per WebSocket frame,
 * while `lake serve` speaks `Content-Length`-framed JSON-RPC over stdio;
 * this translates between the two framings. */
function bridge(ws: WebSocket, proc: ChildProcess): () => void {
  let stdoutBuf = Buffer.alloc(0)
  const onStdout = (chunk: Buffer) => {
    stdoutBuf = Buffer.concat([stdoutBuf, chunk])
    // Emit as many complete Content-Length frames as are buffered.
    for (;;) {
      const headerEnd = stdoutBuf.indexOf('\r\n\r\n')
      if (headerEnd === -1) break
      const header = stdoutBuf.subarray(0, headerEnd).toString('ascii')
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i)
      if (!lengthMatch) {
        // Unframeable output; drop the buffer to resynchronize.
        stdoutBuf = Buffer.alloc(0)
        break
      }
      const bodyStart = headerEnd + 4
      const bodyLength = Number(lengthMatch[1])
      if (stdoutBuf.length < bodyStart + bodyLength) break
      ws.send(stdoutBuf.subarray(bodyStart, bodyStart + bodyLength).toString('utf-8'))
      stdoutBuf = stdoutBuf.subarray(bodyStart + bodyLength)
    }
  }

  const onMessage = (data: Buffer) => {
    const body = data.toString('utf-8')
    proc.stdin!.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  }

  proc.stdout!.on('data', onStdout)
  ws.on('message', onMessage)
  return () => {
    proc.stdout!.off('data', onStdout)
    ws.off('message', onMessage)
  }
}

/** Manages a standalone Lean LSP endpoint (`lake serve`) for a view.
 * Non-reusable; construct a new handle to start a new endpoint.
 *
 * Unlike the editor's VS Code server, this needs no extra sandboxed workspace:
 * `lake serve` is the whole backend, run in the same shared project mount.
 * Each browser WebSocket connection gets its own `lake serve`, bridged to its
 * stdio and killed when the socket closes, so every connection starts from a
 * clean LSP `initialize` handshake. The handle owns only the long-lived bridge
 * socket, which persists across reloads. */
export class LeanLspHandle implements AsyncDisposable {
  /** Unique ID of this LSP endpoint; also the nginx route segment. */
  readonly uuid = crypto.randomUUID()
  /** Directory holding the bridge UDS file. */
  readonly socketDir = `/tmp/lsp-${this.uuid}/`
  /** Host path to the bridge UDS file. */
  readonly socketPath = path.join(this.socketDir, LSP_SOCKET_FILENAME)

  constructor(
    readonly viewer: User,
    readonly owner: User,
    readonly project: Project,
  ) {
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    this.started = promise
    this.resolveStarted = resolve
    this.rejectStarted = reject
  }

  private startCalled = false
  /** Resolves once the bridge socket is listening; rejects on startup failure. */
  readonly started: Promise<void>
  private readonly resolveStarted: () => void
  private readonly rejectStarted: (err: unknown) => void

  /** `bwrap` args binding the project directory, applied to each per-connection server. */
  private projectBindArgs: string[] = []
  /** Teardown for each live connection (unbind, kill its server, close its socket). */
  private connections = new Set<() => void>()
  private disposing: Promise<void> | undefined
  private disposables = new AsyncDisposableStack()

  private get description(): string {
    return `lean-lsp ${this.uuid} (project ${this.project.id}, viewer ${this.viewer.id})`
  }

  /** Browser path that reaches this endpoint through the nginx `/_view/lsp` route. */
  get viewSocketUrl(): string {
    return `/_view/lsp/${this.uuid}/`
  }

  /** Signal the endpoint to start listening. May only be called once; await {@link started}. */
  start(
    /** Arguments to `bwrap` that bind the project directory. Placed at the end. */
    projectBindArgs: string[],
  ): void {
    if (this.startCalled) throw new Error(`Tried to start ${this.description} more than once.`)
    if (this.disposing) throw new Error(`${this.description} was disposed before start.`)
    this.startCalled = true
    this.projectBindArgs = projectBindArgs
    ;(async () => {
      await fs.mkdir(this.socketDir, { recursive: true })
      this.disposables.defer(async () => {
        await fs.rm(this.socketDir, { recursive: true, force: true })
      })

      const wss = new WebSocketServer({ noServer: true })
      const httpServer = createServer()
      httpServer.on('upgrade', (req, socket, head) => {
        wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws))
      })
      wss.on('connection', ws => this.handleConnection(ws))
      this.disposables.defer(async () => {
        for (const teardown of [...this.connections]) teardown()
        await new Promise<void>(resolve => httpServer.close(() => resolve()))
      })

      await new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject)
        httpServer.listen(this.socketPath, resolve)
      })
    })().then(this.resolveStarted, this.rejectStarted)
  }

  /** Spawn a `lake serve` inside the project's bwrap sandbox. */
  private spawnLakeServe(): ChildProcess {
    const homeDir = getUserHomeDir(this.viewer.name)
    return spawn(
      'bwrap',
      // prettier-ignore
      [
        ...BWRAP_ARGS,
        '--ro-bind', getElanDir(), getElanDir(),
        '--bind', homeDir, bwrapHomeDir(this.viewer.name),
        '--setenv', 'HOME', bwrapHomeDir(this.viewer.name),
        '--setenv', 'ELAN_HOME', getElanDir(),
        '--setenv', 'PATH', `${getElanDir()}/bin:/usr/local/bin:/usr/bin:/bin`,
        '--chdir', bwrapProjectDir(this.project.name),
        ...this.projectBindArgs,
        '--',
        path.join(getElanDir(), 'bin', 'lake'), 'serve',
      ],
      { stdio: ['pipe', 'pipe', 'inherit'] },
    )
  }

  /** Give a new connection its own `lake serve`, tearing both down when either ends. */
  private handleConnection(ws: WebSocket): void {
    const proc = this.spawnLakeServe()
    const unbind = bridge(ws, proc)
    let torn = false
    const teardown = () => {
      if (torn) return
      torn = true
      this.connections.delete(teardown)
      unbind()
      proc.kill()
      ws.close()
    }
    this.connections.add(teardown)
    proc.on('error', err => {
      console.error(`error in ${this.description}: ${String(err)}`)
      teardown()
    })
    proc.on('close', teardown)
    ws.on('close', teardown)
  }

  /** Add a callback to the LIFO {@link AsyncDisposableStack} that runs on `dispose()`. */
  addDisposable(f: () => Promise<void>) {
    this.disposables.defer(f)
  }

  /** Shut the endpoint down and release its resources.
   * Repeated calls produce the same promise. Must be invoked after a `start()` failure. */
  async [Symbol.asyncDispose]() {
    if (this.disposing) return this.disposing
    this.disposing = (async () => {
      if (this.startCalled) {
        await this.started.catch(() => {})
      } else {
        this.rejectStarted(new Error(`${this.description} was disposed before start.`))
      }
      await this.disposables.disposeAsync()
    })()
    await this.disposing
  }
}
