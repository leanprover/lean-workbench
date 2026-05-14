import { getCollabServerDir } from '@/lib/server/config'
import { BWRAP_ARGS, bwrapProjectDir } from '@/lib/server/util'
import { Project } from '@/prisma/generated/client'
import { ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

/** Name of the `collab-server` UDS file. */
export const COLLAB_SOCKET_FILENAME = 'collab.sock'

/** Name of the `collab-server` database file. */
export const COLLAB_DB_FILENAME = 'collab.db'

/** Manages a collaboration server instance.
 * Non-reusable; construct a new handle to start a new server. */
export class CollabServerHandle {
  /** Unique ID of this `collab-server` instance. */
  readonly uuid = crypto.randomUUID()
  /** Directory in which `collab-server` places its files. */
  readonly workDir: string = `/tmp/collab-server-${this.uuid}/`
  /** Path to the `collab-server` UDS file. */
  readonly socketPath: string = path.join(this.workDir, COLLAB_SOCKET_FILENAME)

  constructor(
    /** Project that this server manages. */
    readonly project: Project,
    /** Directory in which project files are stored. */
    readonly projectDir: string,
  ) {}

  /** The `bwrap` process. Defined iff the process is running. */
  private proc: ChildProcess | undefined
  /** Defined after {@link start} has been called. */
  private starting: Promise<void> | undefined
  /** Defined after {@link dispose} has been called. */
  private disposing: Promise<void> | undefined
  /** Resources allocated for the server. */
  private disposables = new AsyncDisposableStack()

  private get description(): string {
    return `collab-server ${this.uuid} (project '${this.project.id}')`
  }

  /** Signal the server to start.
   * The returned promise resolves when the server is ready
   * and has created its UDS file.
   * Throws if the server fails to start or set up.
   * Repeated calls produce the same promise. */
  async start() {
    if (this.starting) return this.starting
    this.starting = (async () => {
      await fs.mkdir(this.workDir, { recursive: true })
      this.disposables.defer(async () => {
        await fs.rm(this.workDir, { recursive: true, force: true })
      })

      const sandboxProjectDir = bwrapProjectDir(this.project.name)
      const proc = spawn(
        'bwrap',
        // prettier-ignore
        [
          ...BWRAP_ARGS,
          // We don't need internet access.
          '--unshare-net',
          '--ro-bind', getCollabServerDir(), getCollabServerDir(),
          '--bind', this.projectDir, sandboxProjectDir,
          '--bind', this.workDir, '/workspace/.collab-server',
          '--chdir', '/workspace/.collab-server',
          '/usr/bin/node',
          path.join(getCollabServerDir(), 'dist', 'server.js'),
          sandboxProjectDir,
        ],
        { stdio: 'inherit' },
      )
      proc.on('error', err => {
        console.error(`error in ${this.description}: ${String(err)}`)
      })
      this.proc = proc

      await Promise.race([
        // Reject if errors occur or server shuts down before UDS is bound.
        new Promise<void>((_, reject) => {
          proc.once('error', err => {
            reject(err)
          })
          proc.once('close', () => {
            this.proc = undefined
            reject(new Error(`${this.description} exited before creating UDS`))
          })
        }),
        // Wait for the server to bind the UDS.
        (async () => {
          const socketPath = path.join(this.workDir, COLLAB_SOCKET_FILENAME)
          const deadline = Date.now() + 10_000
          while (true) {
            try {
              await fs.access(socketPath)
              break
            } catch {}
            if (Date.now() > deadline) throw new Error(`timeout waiting for ${this.description} to create UDS`)
            await new Promise(r => setTimeout(r, 50))
          }
        })(),
      ])
    })()
    await this.starting
  }

  /** Add a callback to the LIFO {@link AsyncDisposableStack} that runs on `dispose()`
   * (after the process has exited). */
  addDisposable(f: () => Promise<void>) {
    this.disposables.defer(f)
  }

  /** Signal the server to shut down and clean up allocated resources.
   * The returned promise resolves when cleanup has completed.
   * Repeated calls produce the same promise.
   * Must be invoked after a `start()` failure. */
  async dispose() {
    if (!this.starting) {
      console.warn(`Tried to stop ${this.description} before starting it.`)
      return
    }
    if (this.disposing) return this.disposing
    this.disposing = (async () => {
      await this.starting!.catch(() => {})
      if (this.proc) {
        await new Promise<void>(resolve => {
          this.proc!.once('close', () => {
            resolve()
          })
          this.proc!.kill()
        })
      }
      await this.disposables.disposeAsync()
    })()
    await this.disposing
  }
}
