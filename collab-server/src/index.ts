// Export that may be bundled into clients (e.g. `vscode-workbench`).
// Must not import server-side code.

export type { CollabRouter } from './trpc'

/** We keep a Y.Doc per collaboratively-editable buffer.
 * This is the Y.Doc key under which the text content lives. */
export const YTEXT_KEY = 'content'

/** Route at which `collab-server` serves its tRPC WebSocket endpoint. */
export const COLLAB_TRPC_ROUTE = '/trpc'
