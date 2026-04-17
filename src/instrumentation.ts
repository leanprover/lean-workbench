/** Runs once at startup. Initializing global server state here is a Next.js idiom. */
export async function register() {
  console.log('Initializing server..')
  // https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation#specifying-the-runtime
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // Build complains about importing Node.js in the edge runtime
  // when imports are not guarded.
  const { initConfig } = await import('@/lib/server/config')
  const { initDb } = await import('@/lib/server/db')
  const { initAuth } = await import('@/lib/server/auth')
  const { initEditorSessions } = await import('@/lib/server/editorSessions')
  initConfig()
  initDb()
  await initAuth()
  initEditorSessions()
}
