import fs from 'node:fs/promises'
import path from 'node:path'

import type { BaseUser } from '@leanprover/workbench-shared'
import { getUserHomeDir } from '@leanprover/workbench-shared/node'

/** Create a persistent home directory for the given user,
 * seeding a global Git identity from their profile when available. */
export async function provisionUserHome(user: BaseUser): Promise<void> {
  const homeDir = getUserHomeDir(user)
  await fs.mkdir(homeDir, { recursive: true })

  // Git reads `$HOME/.config/git/config` as the global config.
  const name = user.displayName?.trim() || user.name
  const email = user.email.trim()
  const userBlock = ['[user]']
  if (name) userBlock.push(`\tname = ${name}`)
  if (email) userBlock.push(`\temail = ${email}`)
  if (userBlock.length === 1) return

  const gitConfigDir = path.join(homeDir, '.config', 'git')
  await fs.mkdir(gitConfigDir, { recursive: true })
  await fs.writeFile(path.join(gitConfigDir, 'config'), userBlock.join('\n') + '\n')
}
