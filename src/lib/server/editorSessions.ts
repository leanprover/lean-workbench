import { User } from '@/lib/server/auth'
import {
  getElanDir,
  getNginxConfDir,
  getNginxLogDir,
  getOpenVscodeServerDir,
  getPackageSetsDir,
  getVscodeExtensionsDir,
  getWorkspacesDir,
} from '@/lib/server/config'
import { getDb } from '@/lib/server/db'
import { Project } from '@/prisma/generated/client'
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import 'server-only'

interface EditorSession {
  /** Port on which `openvscode-server` listens. */
  port: number
  /** PID of `bubblewrap`. */
  pid: number
  /** ID of the viewing user. */
  viewerId: string
}

/** Admin-visible information about an editor session. */
export interface EditorSessionInfo extends EditorSession {
  viewerUsername: string
  ownerUsername: string
  projectId: string
  projectName: string
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

function reloadNginx() {
  execSync(`nginx -e ${getNginxLogDir()}/error.log -c ${getNginxConfDir()}/nginx.conf -s reload`)
}

function ensureMachineSettings(projectDir: string): void {
  const machineSettingsDir = path.join(projectDir, '.vscode-data', 'data', 'Machine')
  const machineSettingsFile = path.join(machineSettingsDir, 'settings.json')
  if (!fs.existsSync(machineSettingsFile)) {
    fs.mkdirSync(machineSettingsDir, { recursive: true })
    fs.writeFileSync(
      machineSettingsFile,
      JSON.stringify(
        {
          // TODO: `workspace.trust.enabled` doesn't seem to do anything
          'security.workspace.trust.enabled': false,
          'workbench.startupEditor': 'none',
          'files.watcherExclude': { '/workspace/.elan/**': true },
        },
        null,
        2,
      ) + '\n',
    )
  }
}

/** Build `--overlay-src/--tmp-overlay` args for the project's package sets.
 * These mount each package in the package set in the `bubblewrap` sandbox.
 * Writes go to a tmpfs and are discarded when the container exits. */
async function buildOverlayArgs(projectId: string, projectDir: string, sandboxProjectDir: string): Promise<string[]> {
  const packageSets = await getDb().projectPackageSet.findMany({ where: { projectId } })
  const args: string[] = []
  for (const { packageSet } of packageSets) {
    const setDir = path.join(getPackageSetsDir(), packageSet)
    const packagesFile = path.join(setDir, 'packages.txt')
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
  /** projectId ↦ [sessions for that project]
   *
   * Invariant: each session corresponds to a running process. */
  // FIXME: index by fresh session ID to prevent races
  private editorSessions = new Map<string, EditorSession[]>()
  private availablePorts = new Set<number>(Array.from({ length: MAX_PORT - BASE_PORT + 1 }, (_, i) => BASE_PORT + i))

  /** Start a session for `viewer` to read/edit `project` owned by `owner`,
   * reusing a current session if one already exists.
   * Assumes that `viewer` has permissions to view `project`.
   * Returns the path to the corresponding VSCode `iframe`. */
  async ensureSession(viewer: User, owner: User, project: Project): Promise<string> {
    const session = (this.editorSessions.get(project.id) ?? []).find(s => s.viewerId === viewer.id)
    if (session) return vscodeIframePath(viewer.name, owner.name, project.name)

    const port = this.availablePorts.values().next().value
    if (port === undefined) throw new Error('No available ports')
    this.availablePorts.delete(port)

    const isOwner = viewer.id === owner.id
    const projectDir = path.join(getWorkspacesDir(), owner.name, project.id)
    fs.mkdirSync(projectDir, { recursive: true })
    if (isOwner) {
      ensureMachineSettings(projectDir)
    }

    const sandboxProjectDir = `/workspace/${project.name}`
    // Owner gets persistent bind mount; non-owner gets ephemeral CoW overlay
    const workspaceMount = isOwner
      ? ['--bind', projectDir, sandboxProjectDir]
      : ['--overlay-src', projectDir, '--tmp-overlay', sandboxProjectDir]
    const overlayArgs = await buildOverlayArgs(project.id, projectDir, sandboxProjectDir)

    const child = spawn(
      'bwrap',
      // prettier-ignore
      [
        '--ro-bind', '/usr', '/usr',
        '--ro-bind', '/lib', '/lib',
        '--ro-bind-try', '/lib64', '/lib64',
        '--ro-bind', '/bin', '/bin',
        '--ro-bind', '/etc', '/etc',
        '--ro-bind', getOpenVscodeServerDir(), '/workspace/.openvscode-server',
        '--ro-bind', getElanDir(), '/workspace/.elan',
        '--ro-bind', getVscodeExtensionsDir(), '/workspace/.vscode-extensions',
        ...workspaceMount,
        ...overlayArgs,
        '--proc', '/proc',
        '--dev', '/dev',
        '--tmpfs', '/tmp',
        '--clearenv',
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
        '--unshare-user',
        '--uid', '1000',
        '--gid', '1000',
        '--unshare-pid',
        '--unshare-uts',
        '--unshare-cgroup',
        '--die-with-parent',
        '--new-session',
        '--',
        '/workspace/.openvscode-server/bin/openvscode-server',
        '--host', '127.0.0.1',
        '--port', String(port),
        '--without-connection-token',
        `--server-base-path=${vscodeIframePath(viewer.name, owner.name, project.name)}`,
        '--default-folder', sandboxProjectDir,
        '--extensions-dir', '/workspace/.vscode-extensions',
        '--server-data-dir', `${sandboxProjectDir}/.vscode-data`,
        // TODO: user-data-dir that is persisted per user
      ],
      // FIXME: pipe into a log file?
      { stdio: 'inherit' },
    )

    const newSession: EditorSession = {
      port,
      pid: child.pid!,
      viewerId: viewer.id,
    }
    this.editorSessions.set(project.id, [...(this.editorSessions.get(project.id) ?? []), newSession])
    writeNginxUserRoute(viewer.id, viewer.name, owner.name, project.name, project.id, port)
    reloadNginx()

    child.on('close', () => {
      const sessions = this.editorSessions.get(project.id) ?? []
      this.editorSessions.set(
        project.id,
        sessions.filter(s => s.viewerId !== viewer.id),
      )
      this.availablePorts.add(port)
      try {
        fs.unlinkSync(nginxUserRoutePath(viewer.id, project.id))
        reloadNginx()
      } catch {
        // conf may not exist
      }
    })
    child.on('error', err => {
      console.error(
        `Failed to spawn editor session for viewer '${viewer.name}', project '${owner.name}/${project.name}':`,
        err,
      )
    })

    await waitForPort(port)
    return vscodeIframePath(viewer.name, owner.name, project.name)
  }

  killSession(viewerId: string, projectId: string): void {
    const projectSessions = this.editorSessions.get(projectId) ?? []
    const session = projectSessions.find(s => s.viewerId === viewerId)
    if (!session) return
    try {
      process.kill(session.pid)
    } catch {}
  }

  async listSessions(): Promise<EditorSessionInfo[]> {
    const result: EditorSessionInfo[] = []
    for (const [projectId, sessions] of this.editorSessions) {
      const project = await getDb().project.findUnique({
        where: { id: projectId },
        select: { name: true, user: { select: { name: true } } },
      })
      if (!project) throw new Error(`internal error: unknown project ID ${projectId}`)
      for (const s of sessions) {
        const viewer = await getDb().user.findUnique({
          where: { id: s.viewerId },
          select: { name: true },
        })
        if (!viewer) throw new Error(`internal error: unknown user ID ${s.viewerId}`)
        result.push({
          ...s,
          viewerUsername: viewer.name,
          ownerUsername: project.user.name,
          projectId,
          projectName: project.name,
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
  if (g.__editorSessionManager) throw new Error('internal error: attempted to reinitialize editorSessions module')
  g.__editorSessionManager = new EditorSessionManager()
}

export function getEditorSessionManager(): EditorSessionManager {
  if (!g.__editorSessionManager) initEditorSessions()
  return g.__editorSessionManager!
}
