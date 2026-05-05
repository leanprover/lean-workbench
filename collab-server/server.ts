import { Server } from '@hocuspocus/server'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'

// -- CLI --
if (process.argv.length !== 4) {
  console.error('Usage: node server.ts <socketPath> <projectDir>')
  process.exit(1)
}

const socketPath = process.argv[2]
const projectDir = process.argv[3]

// -- YJS FILE MANAGEMENT --
const YTEXT_KEY = 'content'

function toDiskPath(documentName: string): string {
  const joined = path.join(projectDir, documentName)
  if (!joined.startsWith(projectDir)) {
    throw new Error(`Path traversal in document name: ${documentName}`)
  }
  return joined
}

// -- HTTPS/WS SERVER --
const server = new Server({
  async onLoadDocument(data) {
    const ytext = data.document.getText(YTEXT_KEY)
    if (ytext.length > 0) return
    try {
      const content = await fs.readFile(toDiskPath(data.documentName), 'utf-8')
      ytext.insert(0, content)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
  },
  async onStoreDocument(data) {
    console.log('onstore', data.documentName, data.clientsCount)
    // TODO: this runs more or less whenever someone edits something.
    // - We want better saving semantics:
    //   when *any user* saves, the file is persisted to disk,
    //   but not otherwise.
    // - Dirty state should be reflected for all users:
    //   a boolean in Y.Doc is one option,
    //   whereas Claude recommends storing mtime (or such) in Y.Doc
    //   and computing dirty state from that.
    // - We should persist Y.Docs to a (in-memory or on-disk) database; not the project dir.
    const file = toDiskPath(data.documentName)
    const ytext = data.document.getText(YTEXT_KEY)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, ytext.toString(), 'utf-8')
  },
})

// `server.listen` exposes a port. We use a socket which needs direct `httpServer` access.
server.httpServer.listen(socketPath, () => {
  // Cosmetic monkey-patches to display the correct start screen. Server works regardless of these.
  Object.defineProperty(server, 'webSocketURL', {
    get: () => `ws+unix:${socketPath}`,
  })
  Object.defineProperty(server, 'httpURL', {
    get: () => `http+unix:${socketPath}`,
  })
  server['showStartScreen']()

  // No need to call `onListen` hooks here since we don't register any.
})

await Promise.race([once(process, 'SIGINT'), once(process, 'SIGQUIT'), once(process, 'SIGTERM')])
console.log('Hocuspocus shutting down..')
await server.destroy()

// TODO: ensure writes are flushed to disk.
