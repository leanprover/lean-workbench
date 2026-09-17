import { zProjectName, zUserName } from '@leanprover/workbench-shared'
import { getPublicationDir } from '@leanprover/workbench-shared/node'
import { forbidden } from 'next/navigation'

import { getDb } from '@/lib/server/db'
import { PUB_DURABLE_PREFIX } from '@/lib/server/publish'

/**
 * Resolves a publication URL to the directory holding that publication's files.
 * Nginx calls this as an `auth_request` subrequest while serving the publish origin,
 * then serves files out of the directory it names.
 *
 * The URL to resolve arrives in `X-Auth-URI`.
 * It holds only the leading segments that name the publication,
 * either `/pub/<publicationId>` or `/<owner>/<project>/<kind>`,
 * rather than the whole request path;
 * Nginx appends the rest of the path to the directory itself.
 *
 * A 200 carries the directory in `X-Publication-Dir`.
 * An unresolvable URL answers 403, which Nginx shows the visitor as a 404,
 * since `auth_request` understands no rejection other than 403 and 401.
 *
 * For now, there is no authentication, so all publications are public.
 *
 * See `nginx.conf.template` for the calling configuration.
 */
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
