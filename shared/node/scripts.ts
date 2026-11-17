import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'

import type z from 'zod'

/**
 * For scripting, a simplified "run command, optionally capture output"
 */
export function exe(file: string, args: readonly string[], options?: { cwd?: string; captureStdout?: boolean }) {
  const cwd = options?.cwd ?? process.cwd()
  if (process.env['VERBOSE']) {
    console.log(`% ${file} ${args.map(arg => JSON.stringify(arg)).join(' ')}`)
  }
  return execFileSync(file, args, { stdio: options?.captureStdout ? undefined : 'inherit', encoding: 'utf-8', cwd })
}

/**
 * readFile + JSON.parse + zod.safeParse variant that won't throw an error
 */
export async function readJson<T>(
  file: string,
  zod: z.ZodType<T>,
): Promise<z.ZodSafeParseResult<T> | { success: false; error: unknown }> {
  try {
    const data = await fs.readFile(file, { encoding: 'utf-8', flag: fs.constants.O_NOFOLLOW })
    return zod.safeParse(JSON.parse(data))
  } catch (error) {
    return { success: false, error }
  }
}

/**
 * Expected type of the exported `steps` array in typescript scripts
 */
export type SCRIPT_STEPS = { title?: string; go: () => void | Promise<void> }[]

/**
 * Throws an error if the path exists but isn't a directory
 */
export async function assertIsDir(path: string) {
  let stat
  try {
    stat = await fs.lstat(path)
  } catch {
    // lstat failed, does not exist
    return
  }

  if (!stat.isDirectory()) {
    throw new Error(`'${path}' is not a directory`)
  }
}
