import fs from 'node:fs/promises'
import path from 'node:path'

import { forbidden } from 'next/navigation'

import { verifySignedDirToken } from '@/lib/server/dirToken'

/** Queried by Nginx to authorize a `/_file/<token>/<relPath>` request.
 * Any 2xx makes Nginx serve the file named in the `X-Validated-File-Path` response header,
 * whereas other codes cause Nginx to reject the original request. */
export async function GET(req: Request) {
  const uri = req.headers.get('x-auth-uri') ?? ''
  // Since directory requests are rewritten to <dir>/index.html,
  // we can expect no trailing slash.
  const match = uri.match(/^\/_file\/([^/]+)\/(.*[^/])$/)
  if (!match) forbidden()
  const rootDir = verifySignedDirToken(match[1])
  if (!rootDir) forbidden()
  const realRootDir = await fs.realpath(rootDir).catch(() => null)
  if (!realRootDir) forbidden()
  const filePath = path.resolve(realRootDir, match[2])
  // Ensure the absolute path with symlinks resolved lives under `realRootDir`.
  // If resolution fails, we pass `filePath` through - Nginx will 404 it.
  const realFilePath = await fs.realpath(filePath).catch(() => filePath)
  if (realFilePath !== realRootDir && !realFilePath.startsWith(realRootDir + path.sep)) forbidden()
  return new Response(null, { status: 200, headers: { 'X-Validated-File-Path': realFilePath } })
}
