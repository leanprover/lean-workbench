import { User } from '@/lib/server/auth'
import {
  getCollabServerDir,
  getElanDir,
  getNginxConfDir,
  getNginxLogDir,
  getOpenVscodeServerDir,
  getPackageSetsDir,
  getWorkspacesDir,
  isDevMode,
} from '@/lib/server/config'
import { getDb } from '@/lib/server/db'
import { readProcesses } from '@/lib/server/util'
import { Project } from '@/prisma/generated/client'
import { ChildProcess, exec, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import type Stream from 'node:stream'
import { EventEmitter } from 'node:stream'
import { promisify } from 'node:util'
import 'server-only'

type ProcessState<T = unknown> =
  | { state: 'starting' }
  | ({
      state: 'running' | 'stopping'
      /** The child process. */
      proc: ChildProcess
    } & T)

type EditorSession = {
  /** ID of the viewing user. */
  viewerId: string
  /** ID of the project being viewed. */
  projectId: string
  /** State of the `bwrap` process. */
  state: ProcessState<{
    /** Port on which `openvscode-server` listens. */
    // TODO(security): use UDS via `--socket-path` instead.
    port: number
  }>
}

/** Admin-visible information about a running editor session. */
export interface EditorSessionInfo {
  viewerId: string
  viewerUsername: string
  ownerUsername: string
  projectId: string
  projectName: string
  pid: number
  port: number
}

type CollabServer = {
  /** ID of the project that this server manages. */
  projectId: string
  /** Directory in which `collab-server` places its UDS file. */
  socketDir: string
  /** State of the `bwrap` process */
  state: ProcessState
}

const BASE_PORT = 3010
const MAX_PORT = 3999

async function waitForPort(port: number, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    function attempt() {
      if (Date.now() > deadline) {
        reject(new Error(`Timeout waiting for port ${port}`))
        return
      }
      const socket = net.connect(port, '127.0.0.1')
      socket.once('connect', () => {
        socket.destroy()
        resolve()
      })
      socket.once('error', () => {
        socket.destroy()
        setTimeout(attempt, 1000)
      })
    }
    attempt()
  })
}

function vscodeIframePath(viewerUsername: string, ownerUsername: string, projectName: string) {
  const encodedName = encodeURIComponent(projectName)
  return `/_vs/${viewerUsername}/${ownerUsername}/${encodedName}/`
}

function nginxUserRoutePath(viewerId: string, projectId: string) {
  return `${getNginxConfDir()}/user-routes/${viewerId}-${projectId}.conf`
}

function writeNginxUserRoute(
  viewerId: string,
  viewerUsername: string,
  ownerUsername: string,
  projectName: string,
  projectId: string,
  port: number,
): void {
  const conf = `location ${vscodeIframePath(viewerUsername, ownerUsername, projectName)} {
  proxy_pass http://127.0.0.1:${port};
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;
  proxy_set_header Host $http_host;
  proxy_buffering off;
  proxy_read_timeout 86400;
  proxy_hide_header X-Frame-Options;
}
`
  fs.writeFileSync(nginxUserRoutePath(viewerId, projectId), conf)
}

async function reloadNginx(): Promise<void> {
  await promisify(exec)(`nginx -e ${getNginxLogDir()}/error.log -c ${getNginxConfDir()}/nginx.conf -s reload`)
}

function ensureMachineSettings(serverDataDir: string): void {
  const machineSettingsDir = path.join(serverDataDir, 'data', 'Machine')
  const machineSettingsFile = path.join(machineSettingsDir, 'settings.json')
  if (!fs.existsSync(machineSettingsFile)) {
    fs.mkdirSync(machineSettingsDir, { recursive: true })
    fs.writeFileSync(
      machineSettingsFile,
      JSON.stringify(
        {
          // Start with a blank tab
          'workbench.startupEditor': 'none',
        },
        null,
        2,
      ) + '\n',
    )
  }
}

/** Arguments that we pass to every bubblewrap sandbox. */
const BWRAP_ARGS =
  /* prettier-ignore */ [
    '--ro-bind', '/usr', '/usr',
    '--ro-bind', '/lib', '/lib',
    '--ro-bind-try', '/lib64', '/lib64',
    '--ro-bind', '/bin', '/bin',
    '--ro-bind', '/etc', '/etc',
    '--proc', '/proc',
    '--dev', '/dev',
    '--tmpfs', '/tmp',
    '--unshare-user',
    '--uid', '1000',
    '--gid', '1000',
    '--unshare-pid',
    '--unshare-uts',
    '--unshare-cgroup',
    // TODO(security): unshare-net but allow outgoing inet connections for VSC bwraps.
    // https://github.com/containers/bubblewrap/issues/504
    '--die-with-parent',
    '--new-session',
    '--clearenv',
  ]

/** Build `--overlay-src/--tmp-overlay` args for the project's package sets.
 * These mount each package in the package set in the `bubblewrap` sandbox.
 * Writes go to a tmpfs and are discarded when the container exits. */
async function buildOverlayArgs(projectId: string, projectDir: string, sandboxProjectDir: string): Promise<string[]> {
  const packageSets = await getDb().projectPackageSet.findMany({ where: { projectId } })
  const args: string[] = []
  for (const { packageSet } of packageSets) {
    const setDir = path.join(getPackageSetsDir(), packageSet)
    const packagesFile = path.join(setDir, 'packages.txt')
    // FIXME: use fs/promises more
    if (!fs.existsSync(packagesFile)) continue
    const packages = fs.readFileSync(packagesFile, 'utf-8').split('\n').filter(Boolean)
    for (const pkg of packages) {
      fs.mkdirSync(path.join(projectDir, '.lake', 'packages', pkg), { recursive: true })
      // prettier-ignore
      args.push(
        '--overlay-src', path.join(setDir, pkg),
        '--tmp-overlay', path.join(sandboxProjectDir, '.lake', 'packages', pkg),
      )
    }
  }
  return args
}

export class EditorSessionManager {
  /** projectId ↦ [sessions for that project] */
  // FIXME: index by fresh session ID to prevent races
  private sessions = new Map<string, EditorSession[]>()
  /** These events fire after the relevant modification of `sessions`. */
  private sessionEvents = new EventEmitter<{
    /** An editor server has been shut down or has failed to start. */
    stopped: [EditorSession]
  }>()

  /** projectId ↦ server for that project */
  private collabServers = new Map<string, CollabServer>()
  /** These events fire after the relevant modification of `collabServers`. */
  private collabServerEvents = new EventEmitter<{
    /** A collaboration server has been shut down or has failed to start. */
    stopped: [CollabServer]
  }>()

  private availablePorts = new Set<number>(Array.from({ length: MAX_PORT - BASE_PORT + 1 }, (_, i) => BASE_PORT + i))

  constructor() {
    this.sessionEvents.setMaxListeners(0)
    this.collabServerEvents.setMaxListeners(0)

    this.sessionEvents.addListener('stopped', s => {
      if ((this.sessions.get(s.projectId) ?? []).length === 0) {
        // The last editor for this project has stopped.
        this.killCollabServer(s.projectId)
      }
    })

    this.collabServerEvents.addListener('stopped', () => {
      // FIXME: attempt to restart if needed?
    })
  }

  /** Ensure a collaboration server for the given project is running.
   * Returns the directory in which the UDS file is stored. */
  private async ensureCollabServer(project: Project, projectDir: string): Promise<string> {
    let server = this.collabServers.get(project.id)
    while (server) {
      if (server.state.state !== 'stopping') return server.socketDir

      // Wait for existing server to stop; then re-check.
      await new Promise<void>((resolve, reject) => {
        const onStopped = (s: CollabServer) => {
          if (s === server) {
            resolve()
            this.collabServerEvents.removeListener('stopped', onStopped)
          }
        }
        this.collabServerEvents.addListener('stopped', onStopped)
        setTimeout(() => {
          reject(new Error('Collaboration server did not stop after 10s'))
          this.collabServerEvents.removeListener('stopped', onStopped)
        }, 10_000)
      })
      server = this.collabServers.get(project.id)
    }

    const socketDir = `/tmp/collab-server-${crypto.randomUUID()}/`
    fs.mkdirSync(socketDir, { recursive: true })

    server = {
      projectId: project.id,
      socketDir,
      state: { state: 'starting' },
    }
    this.collabServers.set(project.id, server)
    const cleanupServer = () => {
      if (this.collabServers.get(project.id) === server) {
        this.collabServers.delete(project.id)
        fs.rmSync(socketDir, { recursive: true, force: true })
        this.collabServerEvents.emit('stopped', server)
      }
    }

    try {
      const child = spawn(
        'bwrap',
        // prettier-ignore
        [
          ...BWRAP_ARGS,
          '--ro-bind', getCollabServerDir(), '/workspace/.collab-server',
          '--bind', socketDir, '/workspace/.collab-sockets',
          // Mount project files as writable for the collaboration server.
          '--bind', projectDir, '/workspace/project',
          '/usr/bin/node',
          '/workspace/.collab-server/server.ts',
          '/workspace/.collab-sockets/collab.sock',
        ],
        { stdio: 'inherit' },
      )

      server.state = {
        state: 'running',
        proc: child,
      }

      child.on('close', () => {
        cleanupServer()
      })
      child.on('error', err => {
        console.error(`Failed to spawn collaboration server for project '<${project.userId}>/${project.name}':`, err)
      })
    } catch (e) {
      cleanupServer()
      throw e
    }

    return socketDir
  }

  private async killCollabServer(projectId: string) {
    const server = this.collabServers.get(projectId)
    if (!server || server.state.state !== 'running') return
    try {
      server.state.proc.kill()
      server.state.state = 'stopping'
    } catch {}
  }

  private findSession(viewerId: string, projectId: string): EditorSession | undefined {
    const projectSessions = this.sessions.get(projectId) ?? []
    return projectSessions.find(s => s.viewerId === viewerId)
  }

  /** Start a session for `viewer` to read/edit `project` owned by `owner`,
   * reusing a current session if one already exists.
   * Assumes that `viewer` has permissions to view `project`.
   * Returns the path to the corresponding VSCode `iframe`. */
  async ensureSession(viewer: User, owner: User, project: Project): Promise<string> {
    let session = this.findSession(viewer.id, project.id)
    while (session) {
      if (session.state.state !== 'stopping') return vscodeIframePath(viewer.name, owner.name, project.name)

      // Wait for the previous session to stop
      await new Promise<void>((resolve, reject) => {
        const onStopped = (s: EditorSession) => {
          if (s === session) {
            resolve()
            this.sessionEvents.removeListener('stopped', onStopped)
          }
        }
        this.sessionEvents.addListener('stopped', onStopped)
        setTimeout(() => {
          reject(new Error('Editor session did not stop after 10s'))
          this.sessionEvents.removeListener('stopped', onStopped)
        }, 10_000)
      })
      session = this.findSession(viewer.id, project.id)
    }

    // Store an entry in the sessions map synchronously
    // so that concurrent requests do not try to start multiple editor servers.
    session = {
      viewerId: viewer.id,
      projectId: project.id,
      state: { state: 'starting' },
    }
    this.sessions.set(project.id, [...(this.sessions.get(project.id) ?? []), session])
    const deleteSession = () => {
      const projectSessions = this.sessions.get(project.id) ?? []
      let deleted = false
      this.sessions.set(
        project.id,
        projectSessions.filter(s => {
          if (s === session) {
            deleted = true
            return false
          } else {
            return true
          }
        }),
      )
      if (deleted) this.sessionEvents.emit('stopped', session)
    }

    try {
      const projectDir = path.join(getWorkspacesDir(), owner.name, project.id)
      if (!fs.existsSync(projectDir)) throw new Error(`Project directory '${projectDir}' does not exist`)

      const collabSocketDir = await this.ensureCollabServer(project, projectDir)

      // Every user gets their own VSCode server configuration, and set of installed extensions.
      // Openvscode-server derives --user-data-dir and --extensions-dir from --server-data-dir:
      // https://github.com/gitpod-io/openvscode-server/blob/2bfb814c5215c51a10e80c2cb1b58ed91068ad8b/src/vs/server/node/server.main.ts
      const vscServerDataDir = path.join(getWorkspacesDir(), viewer.name, 'vscode-remote')
      fs.mkdirSync(vscServerDataDir, { recursive: true })
      ensureMachineSettings(vscServerDataDir)

      const sandboxProjectDir = `/workspace/${project.name}`
      const overlayArgs = await buildOverlayArgs(project.id, projectDir, sandboxProjectDir)

      const port = this.availablePorts.values().next().value
      if (port === undefined) throw new Error('No available ports')

      const devArgs = isDevMode()
        ? /* prettier-ignore */ [
            // Instructs Node to bind its debugger to this address, when debugging is enabled.
            // FIXME: VSC also passes --experimental-network-inspection to the extension host,
            // but that is disallowed in NODE_OPTIONS.
            '--setenv', 'NODE_OPTIONS', '--inspect-port=0.0.0.0:9229',
          ]
        : []

      const child = spawn(
        'bwrap',
        // prettier-ignore
        [
          ...BWRAP_ARGS,
          '--ro-bind', getOpenVscodeServerDir(), '/workspace/.openvscode-server',
          '--ro-bind', getElanDir(), '/workspace/.elan',
          // VSCode workspace configuration. Ephemeral, so not need to store on host.
          // The filename must be friendly: it shows up in VSC with (AFAICT) no way to override.
          '--ro-bind-data', '3', '/workspace/Projects.code-workspace',
          '--bind', vscServerDataDir, '/workspace/.vscode-remote',
          // The filesystem gets a read-only view of the project.
          // Writes are mediated through the collaboration server,
          // which `WorkbenchFileSystemProvider` in our extension connects to.
          '--ro-bind', projectDir, sandboxProjectDir,
          '--bind', collabSocketDir, '/workspace/.collab-sockets',
          ...overlayArgs,
          '--setenv', 'HOME', '/workspace',
          '--setenv', 'ELAN_HOME', '/workspace/.elan',
          '--setenv', 'PATH', `/workspace/.elan/bin:/usr/local/bin:/usr/bin:/bin`,
          // FIXME: Git's "dubious ownership" check (CVE-2022-24765) rejects repos
          // owned by a different uid. The overlay mounts cause an ownership mismatch
          // that triggers this; safe.directory=* *should* be ok here since the sandbox
          // is already isolated, but this should be considered more carefully.
          '--setenv', 'GIT_CONFIG_COUNT', '1',
          '--setenv', 'GIT_CONFIG_KEY_0', 'safe.directory',
          '--setenv', 'GIT_CONFIG_VALUE_0', '*',
          ...devArgs,
          '--',
          '/workspace/.openvscode-server/bin/openvscode-server',
          '--host', '127.0.0.1',
          '--port', String(port),
          '--without-connection-token',
          `--server-base-path=${vscodeIframePath(viewer.name, owner.name, project.name)}`,
          '--server-data-dir', '/workspace/.vscode-remote',
          // TODO: make a per-project user-data-dir to support concurrent editing sessions.
          '--default-workspace', '/workspace/Projects.code-workspace',
        ],
        // FIXME: pipe into a log file?
        // stdin, stdout, stderr, ro-bind-data
        { stdio: ['inherit', 'inherit', 'inherit', 'pipe'] },
      )

      session.state = {
        state: 'running',
        proc: child,
        port,
      }
      this.availablePorts.delete(port)

      // Runs both on ordinary shutdown and on error.
      child.on('close', async () => {
        session.state.state = 'stopping'
        try {
          fs.unlinkSync(nginxUserRoutePath(viewer.id, project.id))
          await reloadNginx()
        } catch {
          // conf may not exist
        }
        this.availablePorts.add(port)
        deleteSession()
      })
      child.on('error', err => {
        console.error(
          `Failed to spawn editor session for viewer '${viewer.name}', project '${owner.name}/${project.name}':`,
          err,
        )
      })

      try {
        const workspaceConfigPipe = child.stdio[3] as Stream.Writable
        workspaceConfigPipe.end(
          JSON.stringify({
            folders: [
              {
                name: project.name,
                uri: 'wrkbnch:///',
              },
            ],
          }),
        )

        writeNginxUserRoute(viewer.id, viewer.name, owner.name, project.name, project.id, port)
        await waitForPort(port)
        await reloadNginx()

        return vscodeIframePath(viewer.name, owner.name, project.name)
      } catch (e) {
        child.kill()
        throw e
      }
    } catch (e) {
      deleteSession()
      throw e
    }
  }

  killSession(viewerId: string, projectId: string): void {
    const session = this.findSession(viewerId, projectId)
    if (!session || session.state.state !== 'running') {
      console.warn(`Tried to kill nonexistent session '${viewerId} editing ${projectId}'`)
      return
    }
    try {
      session.state.proc.kill()
      session.state.state = 'stopping'
    } catch {}
  }

  /** Start a debugger in the extension host of the given VSCode session. */
  debugSession(viewerId: string, projectId: string) {
    const session = this.findSession(viewerId, projectId)
    if (!session || session.state.state !== 'running') {
      console.warn(`Tried to debug nonexistent session '${viewerId} editing ${projectId}'`)
      return
    }
    // Send SIGUSR1 to the (assumed unique) extension host descendant of openvscode-server:
    // https://nodejs.org/api/process.html#signal-events
    const root = readProcesses().get(session.state.proc.pid!)
    const stack = root ? [root] : []
    while (stack.length > 0) {
      const proc = stack.pop()!
      if (proc.cmdline.includes('--type=extensionHost')) {
        process.kill(proc.pid, 'SIGUSR1')
        return
      }
      stack.push(...proc.children)
    }
    console.warn(`Extension host not found for session '${viewerId} editing ${projectId}'`)
  }

  async listSessions(): Promise<EditorSessionInfo[]> {
    const result: EditorSessionInfo[] = []
    for (const [projectId, sessions] of this.sessions) {
      const project = await getDb().project.findUnique({
        where: { id: projectId },
        select: { name: true, user: { select: { name: true } } },
      })
      if (!project) throw new Error(`internal error: unknown project ID ${projectId}`)
      for (const s of sessions) {
        if (s.state.state !== 'running') continue
        const viewer = await getDb().user.findUnique({
          where: { id: s.viewerId },
          select: { name: true },
        })
        if (!viewer) throw new Error(`internal error: unknown user ID ${s.viewerId}`)
        result.push({
          viewerId: s.viewerId,
          viewerUsername: viewer.name,
          ownerUsername: project.user.name,
          projectId,
          projectName: project.name,
          pid: s.state.proc.pid!,
          port: s.state.port,
        })
      }
    }
    return result
  }
}

const g = globalThis as typeof globalThis & {
  __editorSessionManager?: EditorSessionManager
}

export function initEditorSessions() {
  if (!g.__editorSessionManager) {
    g.__editorSessionManager = new EditorSessionManager()
  } else {
    // On HMR the module re-evaluates and `EditorSessionManager` becomes a fresh class;
    // rebind so that the global instance picks up updated methods.
    Object.setPrototypeOf(g.__editorSessionManager, EditorSessionManager.prototype)
  }
}

export function getEditorSessionManager(): EditorSessionManager {
  return g.__editorSessionManager!
}

initEditorSessions()
