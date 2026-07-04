import 'server-only'

import fs from 'node:fs/promises'
import path from 'node:path'

import type { User } from '@/lib/server/auth'
import { getUserHomeDir } from '@/lib/server/config'

/** Create a persistent home directory for the given user,
 * seeding a global Git identity from their profile when available. */
export async function provisionUserHome(user: User): Promise<void> {
  const homeDir = getUserHomeDir(user.name)
  await fs.mkdir(homeDir, { recursive: true })

  // Git reads `$HOME/.config/git/config` as the global config.
  const name = user.displayName?.trim() || user.name
  const email = user.email?.trim()
  const userBlock = ['[user]']
  if (name) userBlock.push(`\tname = ${name}`)
  if (email) userBlock.push(`\temail = ${email}`)
  if (userBlock.length === 1) return

  const gitConfigDir = path.join(homeDir, '.config', 'git')
  await fs.mkdir(gitConfigDir, { recursive: true })
  await fs.writeFile(path.join(gitConfigDir, 'config'), userBlock.join('\n') + '\n')
}
