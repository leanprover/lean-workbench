import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'src/prisma/schema.prisma',
  migrations: {
    path: 'src/prisma/migrations',
  },
  datasource: {
    // This envvar is set by the server in `db.ts`
    url: process.env.DATABASE_URL,
  },
})
