import { inferAdditionalFields } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

import type { AuthInstance } from '@/lib/server/auth'

export default createAuthClient({
  // connection errors always throw, this makes non-ok status throw as well so they can be handled similarly
  fetchOptions: { throw: true },
  // https://better-auth.com/docs/concepts/typescript#inferring-additional-fields-on-client
  plugins: [inferAdditionalFields<AuthInstance>()],
})
