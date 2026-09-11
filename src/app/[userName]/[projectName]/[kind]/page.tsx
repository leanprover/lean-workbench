import { zProjectName, zUserName } from '@leanprover/workbench-shared'
import { type Route } from 'next'
import { notFound, redirect } from 'next/navigation'
import z from 'zod'

import { ARTEFACT_KINDS } from '@/lib/server/artefacts'
import { publicationUrl } from '@/lib/server/publish'

const zParams = z.object({
  userName: zUserName,
  projectName: zProjectName,
  kind: z.string(),
})

type Params = z.infer<typeof zParams>

/** Send a link written in the app's own address space to the publication's own origin.
 *
 * Next.js matches static segments before dynamic ones,
 * so `publish` and `preview` stay siblings of this catch-all.
 * Whether the publication exists is the publish origin's business, not ours. */
export default async function PublicationRedirect({ params: params_ }: { params: Promise<Params> }) {
  const parsed = zParams.safeParse(await params_)
  if (!parsed.success) notFound()
  const { userName, projectName, kind } = parsed.data
  if (!ARTEFACT_KINDS.some(k => k.id === kind)) notFound()
  redirect(publicationUrl(userName, projectName, kind) as Route)
}
