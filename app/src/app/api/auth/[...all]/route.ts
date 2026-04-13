import { getAuth } from '@/lib/server/auth'
import { toNextJsHandler } from 'better-auth/next-js'

export const { GET, POST } = toNextJsHandler(req => {
  // Retrieve the auth instance on each request, in case it had been re-initialized
  return getAuth().handler(req)
})
