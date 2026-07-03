import { toNextJsHandler } from 'better-auth/next-js'

import { getAuth } from '@/lib/server/auth'

export const { GET, POST } = toNextJsHandler(async req => {
  // Retrieve the auth instance on each request, in case it had been re-initialized
  const auth = await getAuth()
  return auth.handler(req)
})
