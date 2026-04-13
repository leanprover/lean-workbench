import { getConfig } from '@/lib/server/config'
import { PrismaClient } from '@/prisma/generated/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

// NOTE: if it becomes a problem,
// https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections#prevent-hot-reloading-from-creating-new-instances-of-prismaclient
let db: PrismaClient | null = null

export function getDb(): PrismaClient {
  if (db) return db

  const config = getConfig()
  // Ensure db directory exists
  const dbDir = path.join(config.dataDir, 'db')
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
    throw new Error(`Database migration failed: ${String(e)}`, { cause: e })
  }

  const adapter = new PrismaBetterSqlite3({ url: dbUrl })
  db = new PrismaClient({ adapter })
  return db
}
