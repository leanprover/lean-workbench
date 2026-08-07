import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { request } from 'node:http'
import path from 'node:path'
import type Stream from 'node:stream'

import { type User } from 'better-auth'

import { getConfig, getElanDir, getOpenVscodeServerDir, getUserHomeDir, isDevMode } from '@/lib/server/config'
import { BWRAP_ARGS, bwrapHomeDir, bwrapProjectDir, readProcesses } from '@/lib/server/util'
import { type Project } from '@/prisma/generated/client'

/** Create a VSCode machine settings file if one doesn't exist. */
async function ensureMachineSettings(serverDataDir: string): Promise<void> {
  const machineSettingsDir = path.join(serverDataDir, 'Machine')
  const machineSettingsFile = path.join(machineSettingsDir, 'settings.json')
  try {
    await fs.access(machineSettingsFile)
  } catch {
    await fs.mkdir(machineSettingsDir, { recursive: true })
    await fs.writeFile(
      machineSettingsFile,
      JSON.stringify(
        {
          // Start with a blank tab
          'workbench.startupEditor': 'none',
          // Crucial for collaborative editing.
          // All users share a writable mount of the project.
          // When two users try to save to disk around the same time
          // (manually, or because they have auto-save on), a race occurs.
          // U0 saves and updates the on-disk mtime.
          // U1 attempts to save, but VSCode detects that the mtime is after U1's last save,
          // and produces an error message.
          // This setting instructs VSCode to ignore the mtime and just write.
          // There is an integrity issue:
          // if U3 uses non-collaborative tooling (e.g. a CLI tool on the terminal) to change the file in the meantime,
          // those edits will be lost.
          // FIXME: inform users about this risk, and attempt detection in collab-server.
          'files.saveConflictResolution': 'overwriteFileOnDisk',
          // Auto-save on every keystroke interferes with collaborative editing state.
          'files.autoSave': 'off',
        },
        null,
        2,
      ) + '\n',
    )
  }
}

async function ensureUserSettings(serverDataDir: string): Promise<void> {
  const userSettingsDir = path.join(serverDataDir, 'User')
  const userSettingsFile = path.join(userSettingsDir, 'settings.json')
  try {
    await fs.access(userSettingsDir)
  } catch {
    await fs.mkdir(userSettingsDir, { recursive: true })
    await fs.writeFile(
      userSettingsFile,
      JSON.stringify(
        {
          // Disable telemetry for vscode and well-behaved extensions
          'telemetry.telemetryLevel': 'off',
          'workbench.enableExperiments': false,
          // Don't show vscode "what's new" content or release notes
          'update.mode': 'none',
          'update.showReleaseNotes': false,
          // Hide the secondary sidebar (copilot chat) by default
          'workbench.secondarySideBar.defaultVisibility': 'hidden',
        },
        null,
        2,
      ) + '\n',
    )
  }
}

async function waitForSocket(socketPath: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let status = null
  while (Date.now() < deadline) {
    status = await new Promise<number | null>(resolve => {
      const req = request({ socketPath, path: '/', method: 'HEAD' }, res => {
        res.resume()
        resolve(res.statusCode ?? null)
      })
      req.on('error', () => resolve(null))
      req.end()
    })
    // Any HTTP response means the server is listening on its socket and ready to serve.
    if (status !== null) return
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`Timeout waiting for ${socketPath} (last HTTP status=${status})`)
}

/** Name of the VS Code server UDS file. */
const VSCODE_SOCKET_FILENAME = 'client.sock'

/** Manages a VS Code server instance.
 * Non-reusable; construct a new handle to start a new server. */
export class VscodeServerHandle implements AsyncDisposable {
  /** Unique ID of this VSCode server instance. */
  readonly uuid = crypto.randomUUID()
  /** Directory in which the server places its UDS file. */
  readonly socketDir = `/tmp/vsc-${this.uuid}/`
  /** Host path to the server's UDS file. */
  readonly socketPath = `${this.socketDir}/${VSCODE_SOCKET_FILENAME}`

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

  /** Whether {@link start} has been called. */
  private startCalled = false
  /** Resolves once startup has completed successfully,
   * i.e., the server has started listening on its socket.
   * Rejects if startup throws. */
  readonly started: Promise<void>
  private readonly resolveStarted: () => void
  private readonly rejectStarted: (err: unknown) => void

  /** The `bwrap` process. Defined iff the process is running. */
  private proc: ChildProcess | undefined

  /** Defined after {@link Symbol.asyncDispose} has been called. */
  private disposing: Promise<void> | undefined
  /** Resources allocated for the server. */
  private disposables = new AsyncDisposableStack()

  private get description(): string {
    return `vscode-server ${this.uuid} (project ${this.project.id}, viewer ${this.viewer.id})`
  }

  /** Path and query string that should be used to connect to the VSCode web interface. */
  get vscodeIframeSrc(): string {
    const params = new URLSearchParams({ folder: bwrapProjectDir(this.project.name) })
    return `/_vs/${this.uuid}/?${params}`
  }

  /** Signal the server to start.
   * May only be called once.
   * Use {@link started} to wait until startup completes. */
  start(
    /** Arguments to `bwrap` that bind the project directory. Placed at the end. */
    projectBindArgs: string[],
    /** `collab-server` working directory. */
    collabWorkDir: string,
  ): void {
    if (this.startCalled) {
      throw new Error(`Tried to start ${this.description} more than once.`)
    }
    if (this.disposing) {
      throw new Error(`${this.description} was disposed before start.`)
    }
    this.startCalled = true
    ;(async () => {
      await fs.mkdir(this.socketDir, { recursive: true })
      this.disposables.defer(async () => {
        await fs.rm(this.socketDir, { recursive: true, force: true })
      })

      // The viewer's home directory persists their VS Code configuration and extensions:
      // `code-server` defaults `--user-data-dir` to `$HOME/.local/share/code-server`.
      const homeDir = getUserHomeDir(this.viewer.name)
      const vscUserDataDir = path.join(homeDir, '.local', 'share', 'code-server')
      await ensureMachineSettings(vscUserDataDir)
      await ensureUserSettings(vscUserDataDir)

      const sandboxHomeDir = bwrapHomeDir(this.viewer.name)
      const sandboxProjectDir = bwrapProjectDir(this.project.name)

      const devArgs = isDevMode()
        ? /* prettier-ignore */ [
            // Instructs Node to bind its debugger to this address, when debugging is enabled.
            // FIXME: VSC also passes --experimental-network-inspection to the extension host,
            // but that is disallowed in NODE_OPTIONS.
            '--setenv', 'NODE_OPTIONS', '--inspect-port=0.0.0.0:9229',
          ]
        : []

      const proc = spawn(
        'bwrap',
        // prettier-ignore
        [
          ...BWRAP_ARGS,
          '--ro-bind', getOpenVscodeServerDir(), getOpenVscodeServerDir(),
          '--ro-bind', getElanDir(), getElanDir(),
          '--bind', homeDir, sandboxHomeDir,
          '--bind', collabWorkDir, '/workspace/.collab-server',
          '--bind', this.socketDir, '/workspace/.vscode-server',
          '--ro-bind-data', '3', '/workspace/.lean-workbench.json',
          '--setenv', 'HOME', sandboxHomeDir,
          '--setenv', 'ELAN_HOME', getElanDir(),
          '--setenv', 'PATH', `${getElanDir()}/bin:/usr/local/bin:/usr/bin:/bin`,
          // FIXME: Git's "dubious ownership" check (CVE-2022-24765) rejects repos
          // owned by a different uid. The overlay mounts cause an ownership mismatch
          // that triggers this; safe.directory=* *should* be ok here since the sandbox
          // is already isolated, but this should be considered more carefully.
          '--setenv', 'GIT_CONFIG_COUNT', '1',
          '--setenv', 'GIT_CONFIG_KEY_0', 'safe.directory',
          '--setenv', 'GIT_CONFIG_VALUE_0', '*',
          ...devArgs,
          ...projectBindArgs,
          '--',
          path.join(getOpenVscodeServerDir(), 'bin', 'code-server'),
          '--socket', `/workspace/.vscode-server/${VSCODE_SOCKET_FILENAME}`,
          '--auth', 'none',
          // Disable 'Do you trust this workspace?' modals.
          '--disable-workspace-trust',
          // Disable code-server telemetry
          '--disable-telemetry',
          // Don't tell people they should be updating software they can't update
          '--disable-update-check',
          // Reduce how long the extension host process waits for a web client to reconnect (default 3h).
          '--reconnection-grace-time', '60',
          sandboxProjectDir,
        ],
        // FIXME: pipe into a log file?
        // stdin, stdout, stderr, ro-bind-data
        { stdio: ['inherit', 'inherit', 'inherit', 'pipe'] },
      )
      proc.on('error', err => {
        console.error(`error in ${this.description}: ${String(err)}`)
      })
      this.proc = proc

      const workspaceMdataPipe = proc.stdio[3] as Stream.Writable

      await Promise.race([
        // Reject if errors occur before setup is finished.
        new Promise<void>((_, reject) => {
          proc.once('close', () => {
            this.proc = undefined
            reject(new Error(`${this.description} exited before binding port`))
          })
          proc.once('error', err => {
            reject(new Error(`${this.description} failed to start: ${String(err)}`))
          })
          workspaceMdataPipe.once('error', err => {
            reject(new Error(`${this.description} failed to write workspace metadata: ${String(err)}`))
          })
        }),
        // Wait for the server to start listening.
        (async () => {
          workspaceMdataPipe.end(
            JSON.stringify({
              baseUrl: getConfig().baseUrl,
              viewer: {
                name: this.viewer.name,
                image: this.viewer.image,
              },
              project: {
                name: this.project.name,
                owner: {
                  name: this.owner.name,
                },
              },
              syncPatterns: [path.join(sandboxProjectDir, '**', '*')],
            }),
          )
          await waitForSocket(this.socketPath)
        })(),
      ])

      // Auto-enable debugging in dev mode
      if (isDevMode()) {
        setTimeout(async () => {
          try {
            await this.enableDebugger()
          } catch (err) {
            console.log(err)
          }
        }, 5_000)
      }
    })().then(this.resolveStarted, this.rejectStarted)
  }

  /** Add a callback to the LIFO {@link AsyncDisposableStack} that runs on `dispose()`
   * (after the process has exited). */
  addDisposable(f: () => Promise<void>) {
    this.disposables.defer(f)
  }

  /** Signal the server to shut down and clean up allocated resources.
   * The returned promise resolves when these events have completed.
   * Repeated calls produce the same promise.
   * Must be invoked after a `start()` failure. */
  async [Symbol.asyncDispose]() {
    if (this.disposing) return this.disposing
    this.disposing = (async () => {
      if (this.startCalled) {
        await this.started.catch(() => {})
        if (this.proc) {
          await new Promise<void>(resolve => {
            this.proc!.once('close', () => {
              resolve()
            })
            this.proc!.kill()
          })
        }
      } else {
        this.rejectStarted(new Error(`${this.description} was disposed before start.`))
      }
      await this.disposables.disposeAsync()
    })()
    await this.disposing
  }

  /** Start a debugger in the extension host of the VSCode server. */
  async enableDebugger() {
    const bwrapProc = this.proc
    if (!bwrapProc) return
    // Send SIGUSR1 to the (assumed unique) extension host descendant of code-server:
    // https://nodejs.org/api/process.html#signal-events
    const bwrapProcInfo = (await readProcesses()).get(bwrapProc.pid!)

    // Give up if the bwrap process exited or was replaced while we read proc table
    if (this.proc !== bwrapProc) return
    const stack = bwrapProcInfo ? [bwrapProcInfo] : []
    while (stack.length > 0) {
      const procInfo = stack.pop()!
      if (procInfo.cmdline.includes('--type=extensionHost')) {
        process.kill(procInfo.pid, 'SIGUSR1')
        return
      }
      stack.push(...procInfo.children)
    }
    console.warn(`Extension host not found in ${this.description}`)
  }
}
