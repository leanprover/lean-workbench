import { access } from 'node:fs/promises'

/** Conditional check whether a file exists */
export async function existsAsync(p: string): Promise<boolean> {
  try {
    await access(p)
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

export * from './directories.ts'
