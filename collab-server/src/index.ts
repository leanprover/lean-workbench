import type { Duplex } from 'node:stream'

import type { Extension } from '@hocuspocus/server'
import { type AnyRouter, type inferRouterContext, initTRPC } from '@trpc/server'
import { applyWSSHandler } from '@trpc/server/adapters/ws'
import { WebSocketServer } from 'ws'
import { z } from 'zod'

/** We keep a Y.Doc per collaboratively-editable buffer.
 * This is the Y.Doc key under which the text content lives. */
export const YTEXT_KEY = 'content'

/** A Hocuspocus extension that serves {@link router} over WebSockets at {@link path},
 * letting Hocuspocus handle connections to other paths.
 * {@link path} should include the leading slash.
 * tRPC procedures receive {@link ctx} as their context. */
export function trpcExtension<TRouter extends AnyRouter>(
  router: TRouter,
  path: string,
  ctx: inferRouterContext<TRouter>,
): Extension {
  // https://github.com/websockets/ws/blob/master/README.md#multiple-servers-sharing-a-single-https-server
  const wss = new WebSocketServer({ noServer: true })
  wss.on('connection', ws => {
    ws.on('error', console.error)
  })
  applyWSSHandler({ wss, router, createContext: () => ctx })
  return {
    extensionName: 'tRPC',
    async onUpgrade({ request, socket, head }) {
      if (request.url !== path) return
      wss.handleUpgrade(request, socket as Duplex, head as Buffer, ws => wss.emit('connection', ws, request))
      // Throwing a falsy value prevents Hocuspocus from handling the upgrade (without logging an error).
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw null
    },
    async onDestroy() {
      for (const ws of wss.clients) ws.terminate()
      wss.close()
    },
  }
}

/** Route at which `collab-server` serves its tRPC WebSocket endpoint. */
export const COLLAB_TRPC_ROUTE = '/trpc'

/** Implementations of {@link collabRouter} tRPC procedures. */
export interface CollabContext {
  openDocument: (docName: string, initialText: string) => void
}

const t = initTRPC.context<CollabContext>().create()

/** The tRPC procedures exposed by `collab-server`.
 * These are used to manage collaborative state beyond what Hocuspocus/Yjs supports natively. */
export const collabRouter = t.router({
  /** Makes the Y.Doc named `docName` available for collaboration.
   * Does nothing if a Y.Doc with that name already exists,
   * otherwise creates one with `initialText` as its content.
   * Clients must call this before attaching to `docName` via Hocuspocus. */
  openDocument: t.procedure
    .input(z.object({ docName: z.string(), initialText: z.string() }))
    .mutation(({ ctx, input: { docName, initialText } }) => ctx.openDocument(docName, initialText)),
})

export type CollabRouter = typeof collabRouter
