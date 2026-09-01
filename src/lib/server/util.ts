import 'server-only'

import fs from 'node:fs/promises'

import { notFound } from 'next/navigation'
import type z from 'zod'

import type { ActionResponse } from '@/lib/util'
import type { Project } from '@/prisma/generated/client'

import { requireAuth, type User } from './auth'
import { getDb } from './db'

/** Wrap a server action so that its handler receives only schema-validated input.
 * The raw argument is parsed by {@link schema};
 * on failure the first parser error is returned. */
export function serverAction<S extends z.ZodType, T = void>(
  schema: S,
  handler: (input: z.infer<S>) => Promise<ActionResponse<T>>,
): (raw: z.input<S>) => Promise<ActionResponse<T>> {
  return async raw => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) return { error: parsed.error.issues[0]!.message }
    return handler(parsed.data)
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
    } catch {
      // A throw likely means the process exited after readdir() and before readFile; ignore
      continue
    }
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

/** Where bwrap mounts the given user's home directory. */
export function bwrapHomeDir(userName: string) {
  return `/home/${userName}/`
}

export function canAccessProject(user: User, project: Project) {
  const isOwner = user.id === project.userId
  return isOwner || project.isPublic
}

/** The current viewer, the user named `userName`, and that user's project named `projectName`.
 * Interrupts with 404 if either does not exist, or the viewer may not access the project:
 * 403 would leak the existence of inaccessible projects. */
export async function requireProjectAccess(
  userName: string,
  projectName: string,
): Promise<{ viewer: User; owner: User; project: Project }> {
  const viewer = (await requireAuth()).user
  const db = getDb()
  const owner = await db.user.findUnique({ where: { name: userName } })
  if (!owner) notFound()
  const project = await db.project.findUnique({
    where: { userId_name: { userId: owner.id, name: projectName } },
  })
  if (!project || !canAccessProject(viewer, project)) notFound()
  return { viewer, owner, project }
}

/** Returns `[response, send, close]`.
 * See https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events */
export function sseStreamResponse(onCancel?: () => void): [Response, (msg: object) => void, () => void] {
  let send: (msg: object) => void = () => {}
  let close: () => void = () => {}
  let closed = false
  const encoder = new TextEncoder()
  let keepAliveTimeout: ReturnType<typeof setInterval> | undefined = undefined

  const stream = new ReadableStream({
    start(controller) {
      send = msg => {
        if (closed) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`))
      }
      close = () => {
        if (closed) return
        closed = true
        clearInterval(keepAliveTimeout)
        keepAliveTimeout = undefined
        controller.close()
      }
      // nginx will close connections that don't send some message in 60s
      keepAliveTimeout = setInterval(() => {
        if (closed) return
        controller.enqueue(encoder.encode(`:\n`))
      }, 10_000)
    },
    cancel() {
      closed = true
      clearInterval(keepAliveTimeout)
      keepAliveTimeout = undefined
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
