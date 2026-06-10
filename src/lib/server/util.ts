import type { ActionResponse } from '@/lib/util'
import type { Project } from '@/prisma/generated/client'
import fs from 'node:fs/promises'
import 'server-only'
import z from 'zod'
import type { User } from './auth'

/** Wrap a server action so that its handler receives only schema-validated input.
 * The raw argument is parsed by {@link schema};
 * on failure the first parser error is returned. */
export function serverAction<S extends z.ZodType, T = void>(
  schema: S,
  handler: (input: z.infer<S>) => Promise<ActionResponse<T>>,
): (raw: z.input<S>) => Promise<ActionResponse<T>> {
  return async raw => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) return { error: parsed.error.issues[0].message }
    return handler(parsed.data)
  }
}

export async function existsAsync(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

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
    // TeX format files
    '--ro-bind', '/var/lib/texmf', '/var/lib/texmf',
    '--proc', '/proc',
    '--dev', '/dev',
    '--tmpfs', '/tmp',
    '--unshare-user',
    '--uid', '1000',
    '--gid', '1000',
    '--unshare-pid',
    '--unshare-uts',
    '--unshare-cgroup',
    '--unshare-ipc',
    // TODO(security): unshare-net but allow outgoing inet connections for VSC bwraps.
    // https://github.com/containers/bubblewrap/issues/504
    // https://github.com/rootless-containers/slirp4netns
    '--die-with-parent',
    '--new-session',
    '--clearenv',
    // Override the locale with one that is always present
    '--setenv', 'LC_ALL', 'C.UTF-8',
  ]

/** Where bwrap mounts the given project directory.
 * We identify project files by absolute path,
 * so this has to match across VS Code server and collab-server bwraps. */
export function bwrapProjectDir(projectName: string) {
  return `/workspace/${projectName}/`
}

/** Where bwrap mounts the given user's home directory. */
export function bwrapHomeDir(userName: string) {
  return `/home/${userName}/`
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
