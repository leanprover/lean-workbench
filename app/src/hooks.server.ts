import { building } from '$app/environment'
import { getAuth } from '$lib/server/auth'
import { getConfig } from '$lib/server/config'
import { getDb } from '$lib/server/db'
import { error, type Handle, type ServerInit } from '@sveltejs/kit'
import { svelteKitHandler } from 'better-auth/svelte-kit'

export const init: ServerInit = () => {
  // Run server state initializers
  getConfig()
  getDb()
  getAuth()
}

export const handle: Handle = async ({ event, resolve }) => {
  // Setup guard: block non-setup API access until setup is complete
  // (Redirect is set up in `+layout.server.ts`)
  const cfg = getConfig()
  if (!cfg.isSetupComplete) {
    const p = event.url.pathname
    if (p.startsWith('/api/') && !p.startsWith('/api/setup/')) {
      error(503, 'Setup required')
    }
  }

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
