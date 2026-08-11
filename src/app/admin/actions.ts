'use server'

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { zProjectId, zUserId, zUserName } from '@leanprover/workbench-shared'
import { forbidden } from 'next/navigation'
import z from 'zod'

import { initAuth, requireAuth } from '@/lib/server/auth'
import { getConfig, getDataDir, getWorkspacesDir, saveConfig, zGithubAuthConfig } from '@/lib/server/config'
import { getDb } from '@/lib/server/db'
import { getEditorSessionManager } from '@/lib/server/editorSessions'
import { serverAction } from '@/lib/server/util'
import { type ActionResponse } from '@/lib/util'

export async function requireAdmin() {
  const session = await requireAuth()
  if (!session.user.isAdmin) forbidden()
  return session
}

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
  const userWorkspaceDir = path.join(getWorkspacesDir(), target.name)
  fs.rmSync(userWorkspaceDir, { recursive: true, force: true })

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
export const updateOAuthConfig = serverAction(zUpdateOAuth, async ({ clientId, clientSecret }) => {
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

function parseMeminfo(): Record<string, number> {
  try {
    const text = fs.readFileSync('/proc/meminfo', 'utf8')
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
  const meminfo = parseMeminfo()

  // Load average from /proc/loadavg
  let loadAvg: number[]
  try {
    const text = fs.readFileSync('/proc/loadavg', 'utf8')
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

const zRegistrationMode = z.enum(['open', 'restricted'])

export const setRegistrationMode = serverAction(zRegistrationMode, async mode => {
  await requireAdmin()
  const config = getConfig()
  config.registrationMode = mode
  await saveConfig()
  await initAuth()
  return { ok: undefined }
})

// --- Allowed users ---

const zAddAllowedUser = z.object({
  userName: zUserName,
})

export const addAllowedUser = serverAction(zAddAllowedUser, async ({ userName }) => {
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
