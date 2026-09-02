import 'server-only'

import fs from 'node:fs/promises'

import { parseWithZod } from '@conform-to/zod/v4'
import type z from 'zod'

import type { ActionResponse } from '@/lib/util'
import type { Project } from '@/prisma/generated/client'

import type { User } from './auth'
import { getConfig, isDevMode } from './config'

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

/** Wrap a server action so that it can directly accept `FormData`
 * while its handler will receive only schema-validated input.
 *
 * The [Conform](https://conform.guide/api/zod/parseWithZod) library
 * is used to adapt between `FormData` and the Zod schema.
 */
export function submitAction<S extends z.ZodType, T = void>(
  schema: S,
  handler: (input: z.infer<S>) => Promise<ActionResponse<T>>,
  options: { throwIfInvalid?: boolean } = {},
): (formData: FormData) => Promise<ActionResponse<T>> {
  return async formData => {
    const submission = parseWithZod(formData, {
      schema,
      formatError: (issues: z.core.$ZodIssue[]) => issues[0]!.message,
    })
    if (submission.status !== 'success') {
      const msg = Object.values(submission.error ?? {})[0] ?? `Error validating form submission`
      if (options.throwIfInvalid) throw new Error(msg)
      return { error: msg }
    }
    return handler(submission.value)
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

/**
 * Make a GET request to GitHub's API using the application's OAuth App configuration.
 *
 * Calling `githubAPI('/rate_limit')` will access the endpoint documented at
 * <https://docs.github.com/en/rest/rate-limit/rate-limit?apiVersion=2026-03-10#get-rate-limit-status-for-the-authenticated-user>.
 *
 * If the GitHub OAuth App is not configured, this will throw an error in production.
 */
export async function githubAPI(path: string) {
  const cfg = getConfig()
  const headers: HeadersInit = { Accept: 'application/vnd.github+json', 'X-Github-API-Version': '2026-03-10' }
  if (cfg.githubAuth) {
    const auth = Buffer.from(`${cfg.githubAuth.clientId}:${cfg.githubAuth.clientSecret}`).toString('base64')
    headers.Authorization = `Basic ${auth}`
  } else if (!isDevMode()) {
    throw new Error('Github credentials not available')
  }
  const fullPath = 'https://api.github.com' + path
  console.log(fullPath)
  const response = await fetch(fullPath, { headers })

  if (response.status === 200) return { ok: true, response: (await response.json()) as unknown }
  if (response.headers.get('x-ratelimit-remaining') === '0') {
    const wait = Number(response.headers.get('x-ratelimit-reset')) - Date.now() / 1000
    throw new Error(`GitHub API rate limit exceeded; resets in ${wait} seconds`)
  }
  if (response.status === 401) throw new Error(`GitHub API reported invalid credentials (status 401)`)
  if (response.status === 403) throw new Error(`GitHub API access forbidden (status 403)`)
  console.log(await response.text())
  return { ok: false, status: response.status }
}
