import { requireAdmin } from '$lib/server/auth-helpers'
import { getEditorSessionManager } from '$lib/server/editorSessions'
import { json } from '@sveltejs/kit'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import type { RequestHandler } from './$types'

function parseMeminfo(): Record<string, number> {
  try {
    const text = fs.readFileSync('/proc/meminfo', 'utf8')
    const result: Record<string, number> = {}
    for (const line of text.split('\n')) {
      const m = line.match(/^(\w+):\s+(\d+)/)
      if (m) result[m[1]] = parseInt(m[2], 10) * 1024
    }
    return result
  } catch {
    return {}
  }
}

export const GET: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals)

  let dataVolumeDisk = { total: '?', used: '?', available: '?', percent: '?' }
  try {
    const dfOut = execSync('df -h /data', { encoding: 'utf8' })
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

  const meminfo = parseMeminfo()

  let loadAvg = [0, 0, 0]
  try {
    const text = fs.readFileSync('/proc/loadavg', 'utf8')
    const parts = text.split(' ')
    loadAvg = [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])]
  } catch {
    /* ignore */
  }

  return json({
    activeEditorSessions: getEditorSessionManager().sessionCount,
    dataVolumeDisk,
    uptime: process.uptime(),
    memory: {
      total: meminfo.MemTotal ?? 0,
      available: meminfo.MemAvailable ?? 0,
      swapTotal: meminfo.SwapTotal ?? 0,
      swapFree: meminfo.SwapFree ?? 0,
    },
    loadAvg,
  })
}
