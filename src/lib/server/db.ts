import { getDbDir } from '@/lib/server/config'
import { PrismaClient } from '@/prisma/generated/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import 'server-only'

// https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections#prevent-hot-reloading-from-creating-new-instances-of-prismaclient
const g = globalThis as typeof globalThis & {
  __db?: PrismaClient
}

export function initDb() {
  if (g.__db) throw new Error('internal error: attempted to reinitialize db module')

  // Ensure db directory exists
  const dbDir = getDbDir()
  fs.mkdirSync(dbDir, { recursive: true })
  const dbUrl = `file:${path.join(dbDir, 'lean-workbench.db')}`

  // Run migrations (creating db if it's missing)
  // Must be invoked via CLI: https://github.com/prisma/prisma/issues/4703
  console.log('Updating database schema..')
  try {
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: 'inherit',
    })
  } catch (e: unknown) {
    throw new Error(`Database migration failed: ${String(e)}`)
  }

  const adapter = new PrismaBetterSqlite3({ url: dbUrl })
  g.__db = new PrismaClient({ adapter })
}

export function getDb(): PrismaClient {
  if (!g.__db) initDb()
  return g.__db!
}
