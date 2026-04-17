'use server'

import { requireAuth } from '@/lib/server/actions'
import { initAuth } from '@/lib/server/auth'
import { getConfig, getDataDir, getWorkspacesDir, saveConfig } from '@/lib/server/config'
import { getDb } from '@/lib/server/db'
import { getEditorSessionManager } from '@/lib/server/editorSessions'
import { type ActionResponse } from '@/lib/util'
import { forbidden } from 'next/navigation'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import z from 'zod'

export async function requireAdmin() {
  const session = await requireAuth()
  if (!session.user.isAdmin) forbidden()
  return session
}

// --- User management ---

export async function listUsers() {
  await requireAdmin()
  const db = getDb()
  const users = await db.user.findMany({
    select: { id: true, name: true, isAdmin: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  return users
}

const zToggleAdmin = z.object({
  userId: z.string(),
  isAdmin: z.boolean(),
})

export async function toggleAdmin(userId: string, isAdmin: boolean): Promise<ActionResponse<void>> {
  const session = await requireAdmin()
  const parsed = zToggleAdmin.safeParse({ userId, isAdmin })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  if (parsed.data.userId === session.user.id) {
    return { error: 'Cannot change your own admin status' }
  }
  const db = getDb()
  await db.user.update({
    where: { id: parsed.data.userId },
    data: { isAdmin: parsed.data.isAdmin },
  })
  return { ok: undefined }
}

const zDeleteUser = z.object({
  userId: z.string(),
})

export async function deleteUser(userId: string): Promise<ActionResponse<void>> {
  const session = await requireAdmin()
  const parsed = zDeleteUser.safeParse({ userId })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  if (parsed.data.userId === session.user.id) {
    return { error: 'Cannot delete yourself' }
  }
  const db = getDb()
  const target = await db.user.findUnique({ where: { id: parsed.data.userId } })
  if (!target) return { error: 'User not found' }

  // Kill active editor sessions for this user
  const mgr = getEditorSessionManager()
  for (const s of mgr.listSessions()) {
    const [viewer] = s.key.split('/')
    if (viewer === target.name) {
      mgr.killSession(viewer, s.info.projectId)
    }
  }

  // Remove workspace directory
  const userWorkspaceDir = path.join(getWorkspacesDir(), target.name)
  fs.rmSync(userWorkspaceDir, { recursive: true, force: true })

  // Delete from database (cascades to projects via schema)
  await db.user.delete({ where: { id: parsed.data.userId } })
  return { ok: undefined }
}

// --- OAuth configuration ---

export async function fetchOAuthConfig() {
  await requireAdmin()
  const config = getConfig()
  return {
    clientId: config.githubAuth?.clientId ?? '',
  }
}

const zUpdateOAuth = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().optional(),
  callbackUrl: z.string().optional(),
})

export async function updateOAuthConfig(
  clientId: string,
  clientSecret: string | undefined,
): Promise<ActionResponse<void>> {
  await requireAdmin()
  const parsed = zUpdateOAuth.safeParse({ clientId, clientSecret })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const config = getConfig()

  // Preserve existing secret if not provided
  let resolvedSecret = parsed.data.clientSecret
  if (!resolvedSecret) {
    resolvedSecret = config.githubAuth?.clientSecret
    if (!resolvedSecret) {
      return { error: 'Client secret is required (none configured on server)' }
    }
  }

  config.githubAuth = {
    clientId: parsed.data.clientId,
    clientSecret: resolvedSecret,
  }
  await saveConfig()
  initAuth()
  return { ok: undefined }
}

// --- Editor sessions ---

export async function listEditorSessions() {
  await requireAdmin()
  const mgr = getEditorSessionManager()
  return mgr.listSessions()
}

const zKillEditorSession = z.object({
  viewer: z.string().min(1),
  projectId: z.string().min(1),
})

export async function killEditorSession(viewer: string, projectId: string): Promise<ActionResponse<void>> {
  await requireAdmin()
  const parsed = zKillEditorSession.safeParse({ viewer, projectId })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const mgr = getEditorSessionManager()
  mgr.killSession(parsed.data.viewer, parsed.data.projectId)
  return { ok: undefined }
}

// --- System health ---

function parseMeminfo(): Record<string, number> {
  try {
    const text = fs.readFileSync('/proc/meminfo', 'utf8')
    const result: Record<string, number> = {}
    for (const line of text.split('\n')) {
      const m = line.match(/^(\w+):\s+(\d+)/)
      if (m) result[m[1]] = parseInt(m[2], 10) * 1024 // kB -> bytes
    }
    return result
  } catch {
    return {}
  }
}

export async function fetchHealth() {
  await requireAdmin()

  // Disk usage
  let dataVolumeDisk = { total: '?', used: '?', available: '?', percent: '?' }
  try {
    const dfOut = execFileSync('df', ['-h', getDataDir()], { encoding: 'utf8' })
    const lines = dfOut.trim().split('\n')
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/)
      dataVolumeDisk = {
        total: parts[1] ?? '?',
        used: parts[2] ?? '?',
        available: parts[3] ?? '?',
        percent: parts[4] ?? '?',
      }
    }
  } catch {
    /* ignore df failures */
  }

  // Memory from /proc/meminfo
  const meminfo = parseMeminfo()

  // Load average from /proc/loadavg
  let loadAvg = [0, 0, 0]
  try {
    const text = fs.readFileSync('/proc/loadavg', 'utf8')
    const parts = text.split(' ')
    loadAvg = [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])]
  } catch {
    /* ignore */
  }

  const mgr = getEditorSessionManager()

  return {
    activeEditorSessions: mgr.sessionCount,
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

export async function fetchDiskUsage() {
  await requireAdmin()
  const workspacesDir = getWorkspacesDir()
  try {
    const out = execFileSync('du', ['-sh', workspacesDir], { encoding: 'utf8', timeout: 30_000 })
    const size = out.split('\t')[0] ?? '?'
    return { workspaces: size }
  } catch (e: unknown) {
    throw new Error(`Failed to compute disk usage: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// --- Registration mode ---

const zRegistrationMode = z.enum(['open', 'restricted'])

export async function fetchRegistrationMode() {
  await requireAdmin()
  return getConfig().registrationMode
}

export async function setRegistrationMode(mode: string): Promise<ActionResponse<void>> {
  await requireAdmin()
  const parsed = zRegistrationMode.safeParse(mode)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const config = getConfig()
  config.registrationMode = parsed.data
  await saveConfig()
  return { ok: undefined }
}

// --- Allowed users ---

export async function listAllowedUsers() {
  await requireAdmin()
  const users = await getDb().allowedGithubUser.findMany({
    orderBy: { githubUsername: 'asc' },
  })
  return users.map(u => u.githubUsername)
}

const zAddAllowedUser = z.object({
  username: z
    .string()
    .transform(s => s.trim().toLowerCase())
    .pipe(z.string().min(1, 'Username is required')),
})

export async function addAllowedUser(username: string): Promise<ActionResponse<void>> {
  await requireAdmin()
  const parsed = zAddAllowedUser.safeParse({ username })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  await getDb().allowedGithubUser.upsert({
    where: { githubUsername: parsed.data.username },
    create: { githubUsername: parsed.data.username },
    update: {},
  })
  return { ok: undefined }
}

const zRemoveAllowedUser = z.object({
  username: z.string().min(1),
})

export async function removeAllowedUser(username: string): Promise<ActionResponse<void>> {
  await requireAdmin()
  const parsed = zRemoveAllowedUser.safeParse({ username })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  await getDb().allowedGithubUser.delete({
    where: { githubUsername: parsed.data.username },
  })
  return { ok: undefined }
}
