import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import { getElanDir } from '@leanprover/workbench-shared/node'

import { startTrackedCommand } from './trackedCommand'

const exec = promisify(execFile)

const getElanBin = () => path.join(getElanDir(), 'bin', 'elan')

/**
 * Queries `elan` for a list of installed toolchains.
 *
 * Results for normally-installed release or nightly toolchains are in long-form, e.g.
 * `leanprover/lean4-nightly:nightly-2026-08-27` or `leanprover/lean4:v4.32.2`.
 */
export async function listInstalledToolchains(): Promise<string[]> {
  const ELAN_HOME = getElanDir()
  const { stderr, stdout } = await exec(getElanBin(), ['toolchain', 'list'], {
    env: { ...process.env, ELAN_HOME },
  })
  if (stderr.trim().length !== 0) throw new Error(stderr)
  if (stdout.trim() === 'no installed toolchains') return []
  return stdout
    .split('\n')
    .map(tc => tc.trim())
    .filter(tc => tc.length > 0)
}

export async function elanUninstall(leanVersion: string) {
  const ELAN_HOME = getElanDir()
  const { stderr, stdout } = await exec(getElanBin(), ['toolchain', 'uninstall', leanVersion], {
    env: { ...process.env, ELAN_HOME },
  })
  if (stdout.trim().length !== 0) throw new Error(stdout)

  return stderr
    .split('\n')
    .map(tc => tc.trim())
    .filter(tc => tc.length > 0)
}

export function startElanInstall(leanVersion: string) {
  const ELAN_HOME = getElanDir()
  return startTrackedCommand('elan', getElanBin(), ['toolchain', 'install', leanVersion], {
    env: { ...process.env, ELAN_HOME },
  })
}
