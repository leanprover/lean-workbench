import { zProjectName, zUserName } from '@leanprover/workbench-shared'
import { type Route } from 'next'
import { notFound, redirect } from 'next/navigation'
import z from 'zod'

import { ARTIFACT_KINDS } from '@/lib/server/artifacts'
import { getConfig, isPublishingEnabled } from '@/lib/server/config'
import { publicationUrl } from '@/lib/server/publish'

const zParams = z.object({
  userName: zUserName,
  projectName: zProjectName,
  kind: z.string(),
})

type Params = z.infer<typeof zParams>

/** Redirects `/:userName/:projectName/:kind` to the same path on `pubBaseUrl`,
 * where published artifacts are actually served. */
export default async function PublicationRedirect({ params: params_ }: { params: Promise<Params> }) {
  if (!isPublishingEnabled(getConfig())) notFound()
  const parsed = zParams.safeParse(await params_)
  if (!parsed.success) notFound()
  const { userName, projectName, kind } = parsed.data
  if (!ARTIFACT_KINDS.some(k => k.id === kind)) notFound()
  redirect(publicationUrl(userName, projectName, kind) as Route)
}
