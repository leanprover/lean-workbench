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

/** Polls a file waiting for it to exist, throwing if it the file doesn't exist by the deadline */
export async function waitForFileToExist(
  path: string,
  options?: { timeoutMs?: number; pollMs?: number; description?: string },
) {
  const timeoutMs = options?.timeoutMs ?? 10_000
  const pollMs = options?.pollMs ?? 50
  const deadline = Date.now() + timeoutMs
  while (!(await existsAsync(path))) {
    if (Date.now() > deadline) throw new Error(`timeout waiting on ${options?.description ?? `${path} to exist`}`)
    await new Promise(r => setTimeout(r, pollMs))
  }
}

export * from './directories.ts'
