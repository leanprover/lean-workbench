import { zProjectName, zUserName } from '@leanprover/workbench-shared'
import { getPublicationDir } from '@leanprover/workbench-shared/node'
import { forbidden } from 'next/navigation'

import { getDb } from '@/lib/server/db'
import { PUB_DURABLE_PREFIX } from '@/lib/server/publish'

/** Queried by Nginx to resolve a publication URL to the directory holding its files.
 * A 200 carrying `X-Publication-Dir` makes Nginx serve that directory.
 * An unresolvable URL answers 403, the only rejection `auth_request` understands
 * besides 401; Nginx presents it to the visitor as a 404.
 *
 * Nginx sends only the leading segments that name the publication,
 * and appends the rest of the path to the directory itself.
 *
 * Deliberately performs no authentication:
 * publications are public by construction,
 * and the publish origin carries no session cookies.
 *
 * Everything under `/api/pub-route/` belongs to the publish origin:
 * the publish server block reaches it through `auth_request`,
 * and the app server block denies the whole prefix.
 * A new endpoint for that origin must live here to inherit both halves. */
export async function GET(req: Request) {
  const dir = await resolvePublicationDir(req.headers.get('x-auth-uri') ?? '')
  if (!dir) forbidden()
  return new Response(null, { status: 200, headers: { 'X-Publication-Dir': dir } })
}

async function resolvePublicationDir(uri: string): Promise<string | undefined> {
  const db = getDb()

  const durable = new RegExp(`^/${PUB_DURABLE_PREFIX}/([^/]+)$`).exec(uri)
  if (durable) {
    const publication = await db.publication.findUnique({ where: { id: durable[1]! } })
    return publication ? getPublicationDir(publication.id) : undefined
  }

  const readable = /^\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri)
  if (!readable) return undefined
  const [_all, userName, projectName, kind] = readable
  if (!zUserName.safeParse(userName).success || !zProjectName.safeParse(projectName).success) return undefined

  const publication = await db.publication.findFirst({
    where: { kind: kind!, project: { name: projectName!, user: { name: userName! } } },
  })
  return publication ? getPublicationDir(publication.id) : undefined
}
