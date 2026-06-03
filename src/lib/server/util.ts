import { getPackageSetsDir } from '@/lib/server/config'
import { getDb } from '@/lib/server/db'
import type { Project } from '@/prisma/generated/client'
import fs from 'node:fs/promises'
import path from 'node:path'
import 'server-only'
import type { User } from './auth'

export interface ProcessInfo {
  pid: number
  /** Parent PID. */
  ppid: number
  cmdline: string[]
  children: ProcessInfo[]
}

/** Read the process table from `/proc`,
 * returning a map from PID to process info with children linked.
 * Linux-only. */
export async function readProcesses(): Promise<Map<number, ProcessInfo>> {
  const procs = new Map<number, ProcessInfo>()
  for (const entry of await fs.readdir('/proc')) {
    const pid = Number(entry)
    if (!Number.isInteger(pid)) continue
    try {
      const status = await fs.readFile(`/proc/${pid}/status`, 'utf-8')
      const ppid = Number(status.match(/^PPid:\s*(\d+)/m)![1])
      const cmdline = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf-8')).split('\0')
      procs.set(pid, { pid, ppid, cmdline, children: [] })
    } catch {}
  }
  for (const proc of procs.values()) {
    procs.get(proc.ppid)?.children.push(proc)
  }
  return procs
}

/** Arguments that we pass to every bubblewrap sandbox before any other arguments. */
export const BWRAP_ARGS =
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
    // https://github.com/rootless-containers/slirp4netns
    '--die-with-parent',
    '--new-session',
    '--clearenv',
  ]

/** Where bwrap mounts the given project directory.
 * We identify project files by absolute path,
 * so this has to match across VS Code server and collab-server bwraps. */
export function bwrapProjectDir(projectName: string) {
  return `/workspace/${projectName}/`
}

/** Build `bwrap` arguments that mount a project's package sets inside the sandbox,
 * while creating the necessary directories on the host.
 *
 * Packages are mounted as writable overlays,
 * with `<projectDir>/.lake/packages/<pkg>` (i.e., the usual directory) as the upper layer
 * and `<getPackageSetsDir()>/<packageSet>/<pkg>` as the lower (read-only) layer.
 * Overlayfs work directories are created as subdirectories of {@link overlayWorkDir},
 * which per overlayfs requirements must be on the same filesystem as {@link projectDir}.
 * {@link overlayWorkDir} should also not be a subdirectory of {@link projectDir},
 * to prevent access from within the sandbox. */
export async function buildPackageOverlays(
  projectId: string,
  projectName: string,
  projectDir: string,
  overlayWorkDir: string,
): Promise<string[]> {
  const packageSets = await getDb().projectPackageSet.findMany({ where: { projectId } })
  const sandboxProjectDir = bwrapProjectDir(projectName)
  const args: string[] = []
  for (const { packageSet } of packageSets) {
    const pkgSetDir = path.join(getPackageSetsDir(), packageSet)
    const packagesFile = path.join(pkgSetDir, 'packages.txt')
    try {
      await fs.access(packagesFile)
    } catch {
      console.warn(`[buildPackageOverlays] failed to access ${packagesFile}`)
      continue
    }
    const packages = (await fs.readFile(packagesFile, 'utf-8')).split('\n').filter(Boolean)
    for (const pkg of packages) {
      const lakePkgDir = path.join('.lake', 'packages', pkg)
      const upperDir = path.join(projectDir, lakePkgDir)
      const pkgWorkDir = path.join(overlayWorkDir, pkg)
      await Promise.all([fs.mkdir(upperDir, { recursive: true }), fs.mkdir(pkgWorkDir, { recursive: true })])
      const sandboxPkgDir = path.join(sandboxProjectDir, lakePkgDir)
      // prettier-ignore
      args.push(
        '--overlay-src', path.join(pkgSetDir, pkg),
        '--overlay', upperDir, pkgWorkDir, sandboxPkgDir,
      )
    }
  }
  return args
}

export function canAccessProject(user: User, project: Project) {
  const isOwner = user.id === project.userId
  return isOwner || project.isPublic
}

/** Returns `[response, send, close]`.
 * See https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events */
export function sseStreamResponse(onCancel?: () => void): [Response, (msg: object) => void, () => void] {
  let send: (msg: object) => void = () => {}
  let close: () => void = () => {}
  let closed = false
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      send = msg => {
        if (closed) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`))
      }
      close = () => {
        if (closed) return
        closed = true
        controller.close()
      }
    },
    cancel() {
      closed = true
      if (onCancel) onCancel()
    },
  })

  const response = new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })

  return [response, send, close]
}
