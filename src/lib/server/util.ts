import 'server-only'

import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:stream'
import { promisify } from 'node:util'

import { parseWithZod } from '@conform-to/zod/v4'
import { getElanDir, getTemplatesDir } from '@leanprover/workbench-shared/node'
import * as pty from 'node-pty'
import z from 'zod'

import type { ActionResponse } from '@/lib/util'
import type { Project } from '@/prisma/generated/client'

import { type User } from './auth'
import { type CommandEvents } from './stream'

export const zTemplateMetadata = z.object({
  name: z.string(),
  description: z.string().optional(),
  packageSet: z.string().optional(),
})

export type TemplateMetadata = z.infer<typeof zTemplateMetadata>

/**
 * Read metadata for a specified template,
 * raising an exception if the file is missing or un-parseable.
 */
export async function readTemplateMetadata(templateId: string): Promise<TemplateMetadata> {
  const metaPath = path.join(getTemplatesDir(), templateId, 'metadata.json')
  const raw = await fs.readFile(metaPath, 'utf-8')
  return zTemplateMetadata.parse(JSON.parse(raw))
}

/**
 * Store metadata for a specified template,
 */
export async function saveTemplateMetadata(templateId: string, config: TemplateMetadata) {
  const metaPath = path.join(getTemplatesDir(), templateId, 'metadata.json')
  await fs.writeFile(metaPath, JSON.stringify(/* Defensive re-validation */ zTemplateMetadata.parse(config)))
}

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

export interface TemplateInfo {
  id: string
  name: string
  description: string
}

export async function listTemplates(): Promise<TemplateInfo[]> {
  const templatesDir = getTemplatesDir()

  const result: TemplateInfo[] = [{ id: 'blank', name: 'Blank', description: 'Empty workspace' }]
  const entries = await fs.readdir(templatesDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    let meta: TemplateMetadata
    try {
      meta = await readTemplateMetadata(entry.name)
    } catch (err) {
      console.error(`Skipping template '${entry.name}' due to metadata error`, err)
      continue
    }
    result.push({
      id: entry.name,
      name: meta.name,
      description: meta.description ?? '',
    })
  }

  return result
}

const exec = promisify(execFile)
export async function listInstalledToolchains(): Promise<string[]> {
  const elanDir = getElanDir()
  const { stderr, stdout } = await exec(path.join(elanDir, 'bin', 'elan'), ['toolchain', 'list'], {
    env: { ...process.env, ELAN_HOME: elanDir },
  })

  if (stderr.trim().length !== 0) {
    throw new Error(stderr)
  }

  return stdout
    .split('\n')
    .map(tc => tc.trim())
    .filter(tc => tc.length > 0)
}

export async function elanUninstall(leanVersion: string) {
  const elanDir = getElanDir()
  const { stderr, stdout } = await exec(path.join(elanDir, 'bin', 'elan'), ['toolchain', 'uninstall', leanVersion], {
    env: { ...process.env, ELAN_HOME: elanDir },
  })

  if (stdout.trim().length !== 0) {
    throw new Error(stdout)
  }

  return stderr
    .split('\n')
    .map(tc => tc.trim())
    .filter(tc => tc.length > 0)
}

export function spawnElanInstall(leanVersion: string) {
  const elanDir = getElanDir()

  const ptyProcess = pty.spawn(path.join(elanDir, 'bin', 'elan'), ['toolchain', 'install', leanVersion], {
    name: 'dumb',
    env: { ...process.env, ELAN_HOME: elanDir },
  })

  const emitter = new EventEmitter<CommandEvents>()
  ptyProcess.onData(data => emitter.emit('log', data))
  ptyProcess.onExit(({ exitCode, signal }) => {
    if (signal) emitter.emit('error', `elan was killed by signal ${signal}`)
    else if (exitCode) emitter.emit('error', `elan exited with code ${exitCode}`)
    else emitter.emit('done')
  })

  return emitter
}

export function spawnCreateMathlib(workDir: string, projectId: string, leanVersion: string) {
  const scriptsDir = path.join(process.cwd(), 'scripts')

  const ptyProcess = pty.spawn(path.join(scriptsDir, 'create-mathlib.sh'), [workDir, projectId, leanVersion], {
    name: 'dumb',
  })

  const emitter = new EventEmitter<CommandEvents>()
  ptyProcess.onData(data => emitter.emit('log', data))
  ptyProcess.onExit(({ exitCode, signal }) => {
    if (signal) emitter.emit('error', `script was killed by signal ${signal}`)
    else if (exitCode) emitter.emit('error', `script exited with code ${exitCode}`)
    else emitter.emit('done')
  })

  return emitter
}
