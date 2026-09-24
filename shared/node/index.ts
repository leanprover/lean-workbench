import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { getTempBuildDir } from './directories.ts'

/** Conditional check whether a file exists */
export async function existsAsync(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/**
 * Polls a file waiting for an observation that the file exists,
 * throwing if the file is never observed by the deadline.
 */
export async function waitForFileToExist(
  path: string,
  options?: { timeoutMs?: number; pollMs?: number; description?: string },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 10_000
  const pollMs = options?.pollMs ?? 50
  const deadline = Date.now() + timeoutMs
  while (!(await existsAsync(path))) {
    if (Date.now() > deadline) throw new Error(`timeout waiting on ${options?.description ?? `${path} to exist`}`)
    await new Promise(r => setTimeout(r, pollMs))
  }
}

/** Returns the full path of a fresh scratch directory.
 * Uniqueness is guaranteed by mkdtemp, but `label` is supplied as a
 * human-readable breadcrumb in case it's useful for debugging what
 * was happening after a server crash. */
export async function makeTempBuildDir(label: string): Promise<string> {
  await fs.mkdir(getTempBuildDir(), { recursive: true })
  return fs.mkdtemp(path.join(getTempBuildDir(), `${label}-`))
}

export function isDevMode(): boolean {
  return process.env.NODE_ENV !== 'production'
}

export const execFileAsync = promisify(execFile)

export * from './directories.ts'
