import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../../prisma/generated/client'

const adapter = new PrismaBetterSqlite3({ url: 'TODO URL' })
const db = new PrismaClient({ adapter })

export { db }
