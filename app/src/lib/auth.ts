import db from '$lib/db'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'

export default betterAuth({
  database: prismaAdapter(db, { provider: 'sqlite' }),
  socialProviders: {
    github: {
      clientId: 'TODO',
      clientSecret: 'TODO',
    },
  },
})
