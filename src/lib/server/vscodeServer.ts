import {
  getElanDir,
  getNginxConfDir,
  getNginxLogDir,
  getOpenVscodeServerDir,
  getPackageSetsDir,
  getWorkspacesDir,
  isDevMode,
} from '@/lib/server/config'
import { getDb } from '@/lib/server/db'
import { BWRAP_ARGS, bwrapProjectDir, readProcesses } from '@/lib/server/util'
import { Project } from '@/prisma/generated/client'
import { User } from 'better-auth'
import { ChildProcess, exec, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { request } from 'node:http'
import path from 'node:path'
import { promisify } from 'node:util'

/** Create a VSCode machine settings file if one doesn't exist. */
async function ensureMachineSettings(serverDataDir: string): Promise<void> {
  const machineSettingsDir = path.join(serverDataDir, 'data', 'Machine')
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
        },
        null,
        2,
      ) + '\n',
    )
  }
}

async function reloadNginx(): Promise<void> {
  await promisify(exec)(`nginx -e ${getNginxLogDir()}/error.log -c ${getNginxConfDir()}/nginx.conf -s reload`)
}

async function waitForNginxRoute(path: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let status = null
  while (Date.now() < deadline) {
    status = await new Promise<number | null>(resolve => {
      // `agent: false` creates a new HTTP client, ensuring we connect to the reloaded Nginx.
      const req = request({ host: '127.0.0.1', port: 3000, path, method: 'GET', agent: false }, res => {
        res.resume()
        resolve(res.statusCode ?? null)
      })
      req.on('error', () => resolve(null))
      req.end()
    })
    // The route is gated by `auth_request`,
    // so this unauthenticated probe should return 401 once the route is ready.
    if (status !== null && status === 401) return
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`Timeout waiting for Nginx route ${path} (last HTTP status=${status})`)
}

/** Name of the `openvscode-server` UDS file. */
const VSCODE_SOCKET_FILENAME = 'client.sock'

/** Manages an `openvscode-server` instance.
 * Non-reusable; construct a new handle to start a new server. */
export class VscodeServerHandle {
  /** Unique ID of this VSCode server instance. */
  readonly uuid = crypto.randomUUID()
  /** Route that Nginx exposes the VSCode server on. */
  readonly vscodeIframePath = `/_vs/${this.uuid}/`
  /** Directory in which `openvscode-server` places its UDS file. */
  readonly socketDir = `/tmp/vsc-${this.uuid}/`
  private readonly socketPath = `${this.socketDir}/${VSCODE_SOCKET_FILENAME}`

  constructor(
    readonly viewer: User,
    readonly owner: User,
    readonly project: Project,
    readonly projectDir: string,
    /** `collab-server` working directory. */
    readonly collabWorkDir: string,
  ) {}

  /** The `bwrap` process. Defined iff the process is running. */
  private proc: ChildProcess | undefined
  /** Defined after {@link start} has been called. */
  private starting: Promise<void> | undefined
  /** Defined after {@link dispose} has been called. */
  private disposing: Promise<void> | undefined
  /** Resources allocated for the server. */
  private disposables = new AsyncDisposableStack()

  private get nginxUserRoutePath(): string {
    return `${getNginxConfDir()}/user-routes/openvscode-server-${this.uuid}.conf`
  }

  private get description(): string {
    return `openvscode-server ${this.uuid} (project ${this.project.id}, viewer ${this.viewer.id})`
  }

  private async writeNginxUserRoute() {
    const conf = `location ${this.vscodeIframePath} {
      auth_request /api/auth-vsc/${this.uuid};
      proxy_pass http://unix:${this.socketPath};
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
      proxy_set_header Host $http_host;
      proxy_buffering off;
      proxy_read_timeout 86400;
      proxy_hide_header X-Frame-Options;
  }
  `
    await fs.writeFile(this.nginxUserRoutePath, conf)
  }

  /** Build `--overlay-src/--tmp-overlay` args for the associated project's package sets.
   * These mount each package in the package set in the `bubblewrap` sandbox.
   * Writes go to a tmpfs and are discarded when the container exits. */
  private async buildOverlayArgs(sandboxProjectDir: string): Promise<string[]> {
    const packageSets = await getDb().projectPackageSet.findMany({ where: { projectId: this.project.id } })
    const args: string[] = []
    for (const { packageSet } of packageSets) {
      const setDir = path.join(getPackageSetsDir(), packageSet)
      const packagesFile = path.join(setDir, 'packages.txt')
      try {
        await fs.access(packagesFile)
      } catch {
        continue
      }
      const packages = (await fs.readFile(packagesFile, 'utf-8')).split('\n').filter(Boolean)
      for (const pkg of packages) {
        await fs.mkdir(path.join(this.projectDir, '.lake', 'packages', pkg), { recursive: true })
        // prettier-ignore
        args.push(
          '--overlay-src', path.join(setDir, pkg),
          '--tmp-overlay', path.join(sandboxProjectDir, '.lake', 'packages', pkg),
        )
      }
    }
    return args
  }

  /** Signal the server to start.
   * The returned promise resolves after the server has started listening on its port,
   * and the Nginx route for {@link vscodeIframePath} has been set up.
   * Repeated calls produce the same promise. */
  async start() {
    if (this.starting) return this.starting
    this.starting = (async () => {
      try {
        await fs.access(this.projectDir)
      } catch (err) {
        throw new Error(`Could not open project directory '${this.projectDir}': ${String(err)}`)
      }

      await fs.mkdir(this.socketDir, { recursive: true })
      this.disposables.defer(async () => {
        await fs.rm(this.socketDir, { recursive: true, force: true })
      })

      // Every user gets their own VSCode server configuration, and set of installed extensions.
      // Openvscode-server derives --user-data-dir and --extensions-dir from --server-data-dir:
      // https://github.com/gitpod-io/openvscode-server/blob/2bfb814c5215c51a10e80c2cb1b58ed91068ad8b/src/vs/server/node/server.main.ts
      const vscServerDataDir = path.join(getWorkspacesDir(), this.viewer.name, 'vscode-remote')
      await fs.mkdir(vscServerDataDir, { recursive: true })
      await ensureMachineSettings(vscServerDataDir)

      const sandboxProjectDir = bwrapProjectDir(this.project.name)
      const overlayArgs = await this.buildOverlayArgs(sandboxProjectDir)

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
          '--bind', vscServerDataDir, '/workspace/.vscode-remote',
          // Writes are mediated through the collaboration server,
          // which `WorkbenchFileSystemProvider` in our extension connects to,
          // but users can still write files directly if needed.
          // Lake and other CLI tools do such writes.
          '--bind', this.projectDir, sandboxProjectDir,
          '--bind', this.collabWorkDir, '/workspace/.collab-server',
          '--bind', this.socketDir, '/workspace/.openvscode-server',
          ...overlayArgs,
          '--setenv', 'HOME', '/workspace',
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
          '--',
          path.join(getOpenVscodeServerDir(), 'bin', 'openvscode-server'),
          '--socket-path', `/workspace/.openvscode-server/${VSCODE_SOCKET_FILENAME}`,
          '--without-connection-token',
          `--server-base-path=${this.vscodeIframePath}`,
          '--server-data-dir', '/workspace/.vscode-remote',
          // TODO: make a per-project user-data-dir to support concurrent editing sessions.
          '--default-folder', sandboxProjectDir,
        ],
        // FIXME: pipe into a log file?
        // stdin, stdout, stderr, ro-bind-data
        { stdio: ['inherit', 'inherit', 'inherit', 'pipe'] },
      )
      proc.on('error', err => {
        console.error(`error in ${this.description}: ${String(err)}`)
      })
      this.proc = proc

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
        }),
        // Wait for the server to start listening and for Nginx to be ready.
        (async () => {
          await this.writeNginxUserRoute()
          this.disposables.defer(async () => {
            await fs.rm(this.nginxUserRoutePath, { force: true })
            await reloadNginx()
          })
          await reloadNginx()
          await waitForNginxRoute(this.vscodeIframePath)
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
    })()
    await this.starting
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

  /** Start a debugger in the extension host of the VSCode server. */
  async enableDebugger() {
    if (!this.proc) return
    // Send SIGUSR1 to the (assumed unique) extension host descendant of openvscode-server:
    // https://nodejs.org/api/process.html#signal-events
    const root = (await readProcesses()).get(this.proc.pid!)
    // Give up if parent has exited while we read proc table
    if (!this.proc) return
    const stack = root ? [root] : []
    while (stack.length > 0) {
      const proc = stack.pop()!
      if (proc.cmdline.includes('--type=extensionHost')) {
        process.kill(proc.pid, 'SIGUSR1')
        return
      }
      stack.push(...proc.children)
    }
    console.warn(`Extension host not found in ${this.description}`)
  }
}
