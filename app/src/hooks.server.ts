import { building } from '$app/environment'
import { getAuth } from '$lib/server/auth'
import type { Handle } from '@sveltejs/kit'
import { svelteKitHandler } from 'better-auth/svelte-kit'

export const handle: Handle = async ({ event, resolve }) => {
  const auth = getAuth()
  const session = await auth.api.getSession({
    headers: event.request.headers,
  })

  // Pass session data to other server hooks
  if (session) {
    event.locals.session = session.session
    event.locals.user = session.user
  }

  return svelteKitHandler({ event, resolve, auth, building })
}
