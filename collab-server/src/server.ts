import { once } from 'node:events'
import { DatabaseSync } from 'node:sqlite'

import { Database } from '@hocuspocus/extension-database'
import { Server } from '@hocuspocus/server'
import { BWRAP_COLLAB_DB_PATH, BWRAP_COLLAB_SOCK_PATH } from '@leanprover/workbench-shared'
import * as Y from 'yjs'

import { COLLAB_TRPC_ROUTE, YTEXT_KEY } from './index'
import { collabRouter, trpcExtension } from './trpc'

// -- CLI --
if (process.argv.length !== 3) {
  console.error('Usage: node server.js <projectDir>')
  process.exit(1)
}

const _projectDir = process.argv[2]!
const socketPath = BWRAP_COLLAB_SOCK_PATH
const dbPath = BWRAP_COLLAB_DB_PATH

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
const documentExistsStatement = db.prepare('SELECT 1 FROM document WHERE path = ?')
const documentExists = (path: string): boolean => documentExistsStatement.get(path) !== undefined

// -- HTTPS/WS SERVER --
const server = new Server({
  extensions: [
    trpcExtension(collabRouter, COLLAB_TRPC_ROUTE, {
      openDocument: (docName, initialText) => {
        // Invariant: a document is considered 'open' iff it exists in the DB.
        if (documentExists(docName)) return
        const doc = new Y.Doc()
        doc.getText(YTEXT_KEY).insert(0, initialText)
        // We know !documentExists here since all operations in this function are synchronous
        upsertDocument(docName, Y.encodeStateAsUpdate(doc))
        doc.destroy()
      },
    }),
    new Database({
      async fetch({ documentName }) {
        return selectDocument(documentName) ?? null
      },
      async store({ documentName, state }) {
        upsertDocument(documentName, state)
      },
    }),
  ],
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
  // Deliberate abstraction violation to call showStartScreen()
  ;(server as unknown as { showStartScreen(): void }).showStartScreen()

  // No need to call `onListen` hooks here since we don't register any.
})

await Promise.race([once(process, 'SIGINT'), once(process, 'SIGQUIT'), once(process, 'SIGTERM')])
console.log('Hocuspocus shutting down..')

await server.destroy()
db.close()
