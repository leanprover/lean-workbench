import { Database } from '@hocuspocus/extension-database'
import { Server } from '@hocuspocus/server'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import * as Y from 'yjs'

// -- CLI --
if (process.argv.length !== 3) {
  console.error('Usage: node server.js <projectDir>')
  process.exit(1)
}

const projectDir = process.argv[2]
const socketPath = path.join(process.cwd(), 'collab.sock')
const dbPath = path.join(process.cwd(), 'collab.db')

// -- DB --
const db = new DatabaseSync(dbPath)
db.exec('CREATE TABLE IF NOT EXISTS document (path TEXT PRIMARY KEY NOT NULL, data BLOB NOT NULL)')

const selectDocumentStatement = db.prepare('SELECT data FROM document WHERE path = ?')
const selectDocument = (path: string): Uint8Array | undefined =>
  (selectDocumentStatement.get(path) as { data: Uint8Array } | undefined)?.data
const upsertDocumentStatement = db.prepare(
  'INSERT INTO document (path, data) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET data = excluded.data',
)
const upsertDocument = (path: string, data: Uint8Array): void => {
  upsertDocumentStatement.run(path, data)
}

// -- YJS FILE MANAGEMENT --
// TODO: use const imported from single-source-of-truth module
const YTEXT_KEY = 'content'

function checkedToDiskPath(documentName: string): string {
  const file = path.normalize(documentName)
  if (!file.startsWith(projectDir)) {
    throw new Error(`Path traversal in document name: '${documentName}' escapes '${projectDir}'`)
  }
  return file
}

// -- HTTPS/WS SERVER --
const server = new Server({
  extensions: [
    // Note: we can't use the SQLite extension.
    // Its onLoadDocument would be called after ours,
    // but we want to try it *before* trying the filesystem.
    new Database({
      async fetch({ documentName }) {
        const data = selectDocument(documentName)
        if (data) return data
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
        upsertDocument(documentName, state)
      },
    }),
  ],
})

// TODO: listen for fs events to avoid lost writes.
// VSCs could inform the server about which saves came from them,
// as opposed to other processes (e.g. CLI tools).
// Non-VSC edits could be applied to the Y.Doc as whole-file replacements.

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
db.close()

// TODO: ensure writes are flushed to disk.
