import { Database } from '@hocuspocus/extension-database'
import { Server } from '@hocuspocus/server'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import * as Y from 'yjs'
import { PrismaClient } from './prisma/generated/client'

// -- CLI --
if (process.argv.length !== 4) {
  console.error('Usage: node server.js <projectDir> <betterSqlite3NodePath>')
  process.exit(1)
}

const projectDir = process.argv[2]
// Path to better_sqlite3.node, a native library needed by better-sqlite3.
const nativeBinding = process.argv[3]
const socketPath = path.join(process.cwd(), 'collab.sock')
const dbPath = path.join(process.cwd(), 'collab.db')

// -- DB --
const adapter = new PrismaBetterSqlite3({
  url: `file:${dbPath}`,
  nativeBinding,
})
const db = new PrismaClient({ adapter })
await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS document (path TEXT PRIMARY KEY NOT NULL, data BLOB NOT NULL)')

// -- YJS FILE MANAGEMENT --
// TODO: import vscode-workbench/util
const YTEXT_KEY = 'content'

function checkedToDiskPath(documentName: string): string {
  const file = path.normalize(documentName)
  if (!file.startsWith(projectDir)) {
    throw new Error(`Path traversal in document name: '${documentName}' escapes '${projectDir}'`)
  }
  return file
}

/** Stateless messages sent from clients. */
type ClientMessage = { action: 'save' }

function parseClientMessage(payload: string): ClientMessage {
  const msg = JSON.parse(payload)
  if (msg && typeof msg === 'object' && msg.action === 'save') return { action: 'save' }
  throw new Error(`unexpected stateless payload: ${payload}`)
}

// -- HTTPS/WS SERVER --
const server = new Server({
  extensions: [
    // Note: we can't use the SQLite extension.
    // Its onLoadDocument would be called after ours,
    // but we want to try it *before* trying the filesystem.
    new Database({
      async fetch({ documentName }) {
        const row = await db.document.findUnique({ where: { path: documentName } })
        if (row) return row.data
        let content: string
        try {
          content = await fs.readFile(checkedToDiskPath(documentName), 'utf-8')
        } catch {
          return null
        }
        const doc = new Y.Doc()
        doc.getText(YTEXT_KEY).insert(0, content)
        return Y.encodeStateAsUpdate(doc)
      },
      async store({ documentName, state }) {
        const data = state as Uint8Array<ArrayBuffer>
        await db.document.upsert({
          where: { path: documentName },
          create: { path: documentName, data },
          update: { data },
        })
      },
    }),
  ],
  async onStateless({ documentName, document, payload }) {
    const msg = parseClientMessage(payload)
    if (msg.action === 'save') {
      const file = checkedToDiskPath(documentName)
      const ytext = document.getText(YTEXT_KEY)
      await fs.writeFile(file, ytext.toString(), 'utf-8')
    }
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
