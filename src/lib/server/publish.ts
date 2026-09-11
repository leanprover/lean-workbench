import 'server-only'

import fs from 'node:fs/promises'

import { getPublicationDir } from '@leanprover/workbench-shared/node'

import { getPubBaseUrl } from '@/lib/server/config'
import { getDb } from '@/lib/server/db'
import { type Prisma } from '@/prisma/generated/client'

/** Reserved first segment of a publication's durable URL.
 * Reserved rather than pretty because a user could otherwise be named `p`,
 * which would make `/p/alice/verso` ambiguous between the two URL shapes;
 * `_` cannot start a user name. */
export const PUB_DURABLE_PREFIX = '_pub'

/** The URL a publication is linked by: it names whichever publication is current
 * for this project and kind, and follows the project if it is renamed. */
export function publicationUrl(ownerName: string, projectName: string, kind: string): string {
  return `${getPubBaseUrl()}/${ownerName}/${projectName}/${kind}/`
}

/** The URL that names one publication for good.
 * It survives a user or project rename. */
export function durablePublicationUrl(publicationId: string): string {
  return `${getPubBaseUrl()}/${PUB_DURABLE_PREFIX}/${publicationId}/`
}

/** Take the matching publications out of service and remove their files.
 *
 * Rows go first: a publication is live exactly while its row exists,
 * so an interruption here leaves unreferenced directories
 * rather than rows pointing at files that are gone. */
export async function deletePublications(where: Prisma.PublicationWhereInput): Promise<void> {
  const db = getDb()
  const publications = await db.publication.findMany({ where })
  await db.publication.deleteMany({ where })
  await Promise.all(publications.map(p => fs.rm(getPublicationDir(p.id), { recursive: true, force: true })))
}
