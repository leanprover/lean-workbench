import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../../prisma/generated/client'

const adapter = new PrismaBetterSqlite3({ url: 'TODO URL' })
export default new PrismaClient({ adapter })
