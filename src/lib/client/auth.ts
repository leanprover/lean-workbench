import 'client-only'

import { inferAdditionalFields } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { useRouter } from 'next/navigation'

import type { AuthInstance } from '@/lib/server/auth'

export const authClient = createAuthClient({
  // connection errors always throw, this makes non-ok status throw as well so they can be handled similarly
  fetchOptions: { throw: true },
  // https://better-auth.com/docs/concepts/typescript#inferring-additional-fields-on-client
  plugins: [inferAdditionalFields<AuthInstance>()],
})

/**
 * Returns a function that performs `router.refresh(); await refetch()`.
 */
export function useReloadSession() {
  const router = useRouter()
  const { refetch } = authClient.useSession()
  return async () => {
    router.refresh()
    await refetch()
  }
}

export function githubSignin() {
  const callback = window.location.pathname + window.location.search

  return authClient.signIn.social({
    provider: 'github',
    callbackURL: callback,
    additionalParams: { prompt: 'select_account' },
  })
}
