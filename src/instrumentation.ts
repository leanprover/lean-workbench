import { initAuth } from '@/lib/server/auth'
import { initConfig } from '@/lib/server/config'
import { initDb } from '@/lib/server/db'
import { initEditorSessions } from '@/lib/server/editorSessions'

/** Runs once at startup. Initializing global server state here is a Next.js idiom. */
export async function register() {
  console.log('Initializing server..')
  initConfig()
  initDb()
  await initAuth()
  initEditorSessions()
}
