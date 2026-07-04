import { inferAdditionalFields } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

import type { AuthInstance } from '@/lib/server/auth'

export default createAuthClient({
  // https://better-auth.com/docs/concepts/typescript#inferring-additional-fields-on-client
  plugins: [inferAdditionalFields<AuthInstance>()],
})
