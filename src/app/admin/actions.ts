'use server'

import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'

import {
  EXPECTED_TOOLCHAIN_ID_RE,
  LEAN_BETA_VERSION_RE,
  LEAN_NIGHTLY_VERSION_RE,
  LEAN_STABLE_VERSION_RE,
  zProjectId,
  zTemplateId,
  zUserId,
  zUserName,
  zValidateUserName,
} from '@leanprover/workbench-shared'
import { getDataDir, getUserRootDir, getWorkspacesDir } from '@leanprover/workbench-shared/node'
import z from 'zod'

import { initAuth, requireAdmin } from '@/lib/server/auth'
import { getConfig, saveConfig, zGithubAuthConfig } from '@/lib/server/config'
import { getDb } from '@/lib/server/db'
import { getEditorSessionManager } from '@/lib/server/editorSessions'
import { elanUninstall, startElanInstall } from '@/lib/server/elan'
import { readTemplateMetadata, saveTemplateMetadata, type TemplateMetadata } from '@/lib/server/projectTemplate'
import { getTrackedCommandState } from '@/lib/server/trackedCommand'
import { serverAction, submitAction } from '@/lib/server/util'
import { type ActionResponse } from '@/lib/util'

// --- User management ---

const zToggleAdmin = z.object({
  userId: zUserId,
  isAdmin: z.boolean(),
})

export const toggleAdmin = serverAction(zToggleAdmin, async ({ userId, isAdmin }) => {
  const session = await requireAdmin()
  if (userId === session.user.id) {
    return { error: 'Cannot change your own admin status' }
  }
  const db = getDb()
  await db.user.update({
    where: { id: userId },
    data: { isAdmin },
  })
  return { ok: undefined }
})

const zDeleteUser = z.object({
  userId: zUserId,
})

export const deleteUser = serverAction(zDeleteUser, async ({ userId }) => {
  const session = await requireAdmin()
  if (userId === session.user.id) {
    return { error: 'Cannot delete yourself' }
  }
  const db = getDb()
  const target = await db.user.findUnique({ where: { id: userId } })
  if (!target) return { error: 'User not found' }

  // Kill active editor sessions for this user
  const mgr = getEditorSessionManager()
  for (const s of await mgr.listSessions()) {
    if (s.viewerId === target.id) {
      mgr.killSession(s.projectId, s.sessionId)
    }
  }

  // Remove workspace directory
  const userRootDir = getUserRootDir(target)
  await fs.rm(userRootDir, { recursive: true, force: true })

  // Delete from database (cascades to projects via schema)
  await db.user.delete({ where: { id: userId } })
  return { ok: undefined }
})

// --- OAuth configuration ---

export async function fetchOAuthConfig() {
  await requireAdmin()
  const config = getConfig()
  return {
    clientId: config.githubAuth?.clientId ?? '',
  }
}

const zUpdateOAuth = z.object({
  clientId: zGithubAuthConfig.shape.clientId,
  clientSecret: zGithubAuthConfig.shape.clientSecret.optional(),
})

// FIXME: dedup with saveSetupConfig action somehow?
export const updateOAuthConfig = submitAction(zUpdateOAuth, async ({ clientId, clientSecret }) => {
  await requireAdmin()
  const config = getConfig()

  // Preserve existing secret if not provided
  const resolvedSecret = clientSecret ?? config.githubAuth?.clientSecret
  if (!resolvedSecret) {
    return { error: 'Client secret is required (none configured on server)' }
  }

  config.githubAuth = {
    clientId,
    clientSecret: resolvedSecret,
  }
  await saveConfig()
  await initAuth()
  return { ok: undefined }
})

// --- Editor sessions ---

const zEditorSession = z.object({
  projectId: zProjectId,
  sessionId: z.string().min(1),
})

export const killEditorSession = serverAction(zEditorSession, async ({ projectId, sessionId }) => {
  await requireAdmin()
  const mgr = getEditorSessionManager()
  mgr.killSession(projectId, sessionId)
  return { ok: undefined }
})

// --- System health ---

async function parseMeminfo(): Promise<Record<string, number>> {
  try {
    const text = await fs.readFile('/proc/meminfo', 'utf8')
    const result: Record<string, number> = {}
    for (const line of text.split('\n')) {
      const m = line.match(/^(\w+):\s+(\d+)/)
      if (m) result[m[1]!] = parseInt(m[2]!, 10) * 1024 // kB -> bytes
    }
    return result
  } catch {
    return {}
  }
}

export interface SystemHealth {
  dataVolumeDisk: { total: string; used: string; available: string; percent: string }
  uptime: number
  memory: { total: number; available: number; swapTotal: number; swapFree: number }
  loadAvg: number[]
}

export async function fetchHealth(): Promise<SystemHealth> {
  await requireAdmin()

  // Disk usage
  let dataVolumeDisk: { total: string; used: string; available: string; percent: string }
  try {
    const dfOut = execFileSync('df', ['-h', getDataDir()], { encoding: 'utf8' })
    const lines = dfOut.trim().split('\n')
    if (lines.length < 2) throw new Error('no dataVolumeDisk information')
    const parts = lines[1]!.split(/\s+/)
    dataVolumeDisk = {
      total: parts[1] ?? '?',
      used: parts[2] ?? '?',
      available: parts[3] ?? '?',
      percent: parts[4] ?? '?',
    }
  } catch {
    dataVolumeDisk = { total: '?', used: '?', available: '?', percent: '?' }
  }

  // Memory from /proc/meminfo
  const meminfo = await parseMeminfo()

  // Load average from /proc/loadavg
  let loadAvg: number[]
  try {
    const text = await fs.readFile('/proc/loadavg', 'utf8')
    const parts = text.split(' ')
    loadAvg = [parseFloat(parts[0]!), parseFloat(parts[1]!), parseFloat(parts[2]!)]
  } catch {
    loadAvg = [0, 0, 0]
  }

  return {
    dataVolumeDisk,
    uptime: process.uptime(),
    memory: {
      total: meminfo.MemTotal ?? 0,
      available: meminfo.MemAvailable ?? 0,
      swapTotal: meminfo.SwapTotal ?? 0,
      swapFree: meminfo.SwapFree ?? 0,
    },
    loadAvg,
  }
}

export async function fetchDiskUsage(): Promise<ActionResponse<{ workspaces: string }>> {
  await requireAdmin()
  const workspacesDir = getWorkspacesDir()
  try {
    const out = execFileSync('du', ['-sh', workspacesDir], { encoding: 'utf8', timeout: 30_000 })
    const size = out.split('\t')[0] ?? '?'
    return { ok: { workspaces: size } }
  } catch (e: unknown) {
    console.error(`Failed to compute directory usage`, e)
    return { error: `Could not compute size (the directory may be too large)` }
  }
}

// --- Registration mode ---

const zRegistrationMode = z.object({ mode: z.enum(['open', 'restricted']) })

export const setRegistrationMode = serverAction(zRegistrationMode, async ({ mode }) => {
  await requireAdmin()
  const config = getConfig()
  config.registrationMode = mode
  await saveConfig()
  await initAuth()
  return { ok: undefined }
})

// --- Allowed users ---

const zAddAllowedUser = z.object({
  userName: zValidateUserName,
})

export const addAllowedUser = submitAction(zAddAllowedUser, async ({ userName }) => {
  await requireAdmin()
  await getDb().allowedGithubUser.upsert({
    where: { githubUsername: userName },
    create: { githubUsername: userName },
    update: {},
  })
  return { ok: undefined }
})

const zRemoveAllowedUser = z.object({
  userName: zUserName,
})

export const removeAllowedUser = serverAction(zRemoveAllowedUser, async ({ userName }) => {
  await requireAdmin()
  await getDb().allowedGithubUser.delete({
    where: { githubUsername: userName },
  })
  return { ok: undefined }
})

// -- Templates

const zEditTemplateMetadataRequest = z.object({
  id: zTemplateId,
  name: z.string().optional(),
  description: z.string().optional(),
})

export const editTemplateMetadata = submitAction(
  zEditTemplateMetadataRequest,
  async ({ id, name, description }): Promise<ActionResponse<TemplateMetadata>> => {
    await requireAdmin()

    try {
      if (id === 'blank') throw new Error('cannot modify blank template')
      const config = await readTemplateMetadata(id)
      if (name) config.name = name
      if (!description) {
        delete config.description
      } else {
        config.description = description
      }
      await saveTemplateMetadata(id, config)
      return { ok: config }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  },
)

export async function isTrackedCommandRunning(key: string) {
  await requireAdmin()
  return getTrackedCommandState(key)?.status === 'running'
}

export async function isTrackedCommandAvailable(key: string) {
  await requireAdmin()
  return !!getTrackedCommandState(key)
}

// -- Toolchain management

export const uninstallToolchainVersion = submitAction(
  z.object({ toolchain: z.string().regex(EXPECTED_TOOLCHAIN_ID_RE) }),
  async ({ toolchain }) => {
    await requireAdmin()
    try {
      const output = await elanUninstall(toolchain)
      if (output.length === 0) return { ok: 'elan succeeded with no output' }
      const [_all, _info, info] = output[output.length - 1]!.match(/^(info: )?(.*)$/)!
      return { ok: info }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  },
)

const zChannel = (channel: string, regex: RegExp) =>
  z
    .string()
    .startsWith(`${channel} `)
    .transform(s => s.slice(channel.length + 1))
    .pipe(z.string().regex(regex))

const zToolchainInstallRequest = z.object({
  selectedToolchain: z.union([
    zChannel('stable', LEAN_STABLE_VERSION_RE),
    zChannel('beta', LEAN_BETA_VERSION_RE),
    zChannel('nightly', LEAN_NIGHTLY_VERSION_RE),
  ]),
})

export const doElanInstall = submitAction(zToolchainInstallRequest, async ({ selectedToolchain }) => {
  await requireAdmin()
  return { ok: !!startElanInstall(selectedToolchain) }
})
