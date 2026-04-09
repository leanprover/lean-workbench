import { ChildProcess, execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { getPackageSets } from './db.ts'

export type SandboxMode = 'bubblewrap' | 'off'

export interface EditorSessionInfo {
  port: number
  pid: number
  workspaceDir: string
  projectId: string
}

export interface EditorSessionManagerConfig {
  workspacesDir: string
  elanDir: string
  openVscodeServerDir: string
  vscodeExtensionsDir: string
  nginxConfDir: string
  nginxLogDir: string
  packageSetsDir: string
  sandboxMode: SandboxMode
}

const BASE_PORT = 3010
const MAX_PORT = 3999

export class EditorSessionManager {
  private editorSessions = new Map<string, EditorSessionInfo>()
  private availablePorts: Set<number>

  constructor(private config: EditorSessionManagerConfig) {
    this.availablePorts = new Set(Array.from({ length: MAX_PORT - BASE_PORT + 1 }, (_, i) => BASE_PORT + i))
  }

  private static sessionKey(username: string, projectId: string): string {
    return `${username}/${projectId}`
  }

  private writeNginxConf(
    viewerUsername: string,
    ownerUsername: string,
    projectName: string,
    projectId: string,
    port: number,
  ): void {
    const encodedName = encodeURIComponent(projectName)
    const conf = `location /_vs/${viewerUsername}/${ownerUsername}/${encodedName}/ {
    proxy_pass http://127.0.0.1:${port};
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_read_timeout 86400;
    proxy_hide_header X-Frame-Options;
}
`
    fs.writeFileSync(`${this.config.nginxConfDir}/user-routes/${viewerUsername}-${projectId}.conf`, conf)
  }

  private ensureMachineSettings(workspace: string): void {
    const machineSettingsDir = path.join(workspace, '.vscode-data', 'data', 'Machine')
    const machineSettingsFile = path.join(machineSettingsDir, 'settings.json')
    if (!fs.existsSync(machineSettingsFile)) {
      fs.mkdirSync(machineSettingsDir, { recursive: true })
      fs.writeFileSync(
        machineSettingsFile,
        // TODO: pretty sure this doesn't do anything
        JSON.stringify(
          {
            'security.workspace.trust.enabled': false,
            'workbench.startupEditor': 'none',
            'files.watcherExclude': { '/home/elan/**': true },
          },
          null,
          2,
        ) + '\n',
      )
    }
  }

  private isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  private waitForPort(port: number, timeoutMs = 10000): Promise<void> {
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

  /** Build --overlay-src/--tmp-overlay args for the project's package sets. */
  private buildOverlayArgs(projectId: string, workspaceDir: string, sandboxProjectDir: string): string[] {
    const packageSets = getPackageSets(projectId)
    const args: string[] = []
    for (const setName of packageSets) {
      const setDir = path.join(this.config.packageSetsDir, setName)
      const packagesFile = path.join(setDir, 'packages.txt')
      if (!fs.existsSync(packagesFile)) continue
      const packages = fs.readFileSync(packagesFile, 'utf-8').split('\n').filter(Boolean)
      for (const pkg of packages) {
        fs.mkdirSync(path.join(workspaceDir, '.lake', 'packages', pkg), { recursive: true })
        // prettier-ignore
        args.push(
          '--overlay-src', path.join(setDir, pkg),
          '--tmp-overlay', `${sandboxProjectDir}/.lake/packages/${pkg}`,
        )
      }
    }
    return args
  }

  reloadNginx() {
    execSync(`nginx -e ${this.config.nginxLogDir}/error.log -c ${this.config.nginxConfDir}/nginx.conf -s reload`)
  }

  async startSession(
    viewerUsername: string,
    ownerUsername: string,
    projectName: string,
    projectId: string,
  ): Promise<EditorSessionInfo> {
    const key = EditorSessionManager.sessionKey(viewerUsername, projectId)
    const existing = this.editorSessions.get(key)
    if (existing && this.isAlive(existing.pid)) return existing

    // Clean up stale entry
    if (existing) {
      this.editorSessions.delete(key)
      this.availablePorts.add(existing.port)
    }

    const isOwner = viewerUsername === ownerUsername
    const port = this.availablePorts.values().next().value
    if (port === undefined) throw new Error('No available ports')
    this.availablePorts.delete(port)
    const workspaceDir = path.join(this.config.workspacesDir, ownerUsername, projectId)
    fs.mkdirSync(workspaceDir, { recursive: true })
    if (isOwner) {
      this.ensureMachineSettings(workspaceDir)
    }

    const encodedName = encodeURIComponent(projectName)

    let child: ChildProcess
    if (this.config.sandboxMode === 'bubblewrap') {
      const sandboxProjectDir = `/workspace/${projectName}`

      // Owner gets persistent bind mount; non-owner gets ephemeral CoW overlay
      const workspaceMount = isOwner
        ? ['--bind', workspaceDir, sandboxProjectDir]
        : ['--overlay-src', workspaceDir, '--tmp-overlay', sandboxProjectDir]

      const overlayArgs = this.buildOverlayArgs(projectId, workspaceDir, sandboxProjectDir)

      child = spawn(
        'bwrap',
        // prettier-ignore
        [
          '--ro-bind', '/usr', '/usr',
          '--ro-bind', '/lib', '/lib',
          '--ro-bind-try', '/lib64', '/lib64',
          '--ro-bind', '/bin', '/bin',
          '--ro-bind', '/etc', '/etc',
          '--ro-bind', this.config.openVscodeServerDir, '/workspace/.openvscode-server',
          '--ro-bind', this.config.elanDir, '/workspace/.elan',
          '--ro-bind', this.config.vscodeExtensionsDir, '/workspace/.vscode-extensions',
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
          `--server-base-path=/_vs/${viewerUsername}/${ownerUsername}/${encodedName}/`,
          '--default-folder', sandboxProjectDir,
          '--extensions-dir', '/workspace/.vscode-extensions',
          '--server-data-dir', `${sandboxProjectDir}/.vscode-data`,
          // TODO: user-data-dir that is persisted per user
        ],
        { stdio: 'inherit', detached: true },
      )
    } else {
      child = spawn(
        `${this.config.openVscodeServerDir}/bin/openvscode-server`,
        // prettier-ignore
        [
          '--host', '127.0.0.1',
          '--port', String(port),
          '--without-connection-token',
          `--server-base-path=/_vs/${viewerUsername}/${ownerUsername}/${encodedName}/`,
          '--default-folder', workspaceDir,
          '--extensions-dir', this.config.vscodeExtensionsDir,
          '--server-data-dir', `${workspaceDir}/.vscode-data`,
          // FIXME: symlink package sets?
        ],
        {
          env: {
            ELAN_HOME: this.config.elanDir,
            PATH: `${this.config.elanDir}/bin:${process.env.PATH}`,
          },
        },
      )
    }

    const info: EditorSessionInfo = {
      port,
      pid: child.pid!,
      workspaceDir,
      projectId,
    }
    this.editorSessions.set(key, info)

    this.writeNginxConf(viewerUsername, ownerUsername, projectName, projectId, port)
    this.reloadNginx()

    await this.waitForPort(port)
    return info
  }

  killSession(viewerUsername: string, projectId: string): void {
    const key = EditorSessionManager.sessionKey(viewerUsername, projectId)
    const s = this.editorSessions.get(key)
    if (!s) return
    try {
      process.kill(s.pid)
    } catch {
      // already dead
    }
    this.editorSessions.delete(key)
    this.availablePorts.add(s.port)
    try {
      fs.unlinkSync(`${this.config.nginxConfDir}/user-routes/${viewerUsername}-${projectId}.conf`)
      this.reloadNginx()
    } catch {
      // conf may not exist
    }
  }

  listSessions(): { key: string; info: EditorSessionInfo; alive: boolean }[] {
    const result: { key: string; info: EditorSessionInfo; alive: boolean }[] = []
    for (const [key, info] of this.editorSessions) {
      result.push({ key, info, alive: this.isAlive(info.pid) })
    }
    return result
  }

  get sessionCount(): number {
    return this.editorSessions.size
  }
}
