import { zProjectName, zUserName } from '@leanprover/workbench-shared'
import { type Route } from 'next'
import { notFound, redirect } from 'next/navigation'
import z from 'zod'

import { getConfig, isPublishingEnabled } from '@/lib/server/config'
import { publicationUrl } from '@/lib/server/publish'
import { VIEWS } from '@/lib/server/views'

const zParams = z.object({
  userName: zUserName,
  projectName: zProjectName,
  kind: z.string(),
})

type Params = z.infer<typeof zParams>

/** Redirects `/:userName/:projectName/:kind` to the same path on `pubBaseUrl`,
 * where publications are actually served. */
export default async function PublicationRedirect({ params: params_ }: { params: Promise<Params> }) {
  if (!isPublishingEnabled(getConfig())) notFound()
  const parsed = zParams.safeParse(await params_)
  if (!parsed.success) notFound()
  const { userName, projectName, kind } = parsed.data
  if (!VIEWS.some(v => v.id === kind)) notFound()
  redirect(publicationUrl(userName, projectName, kind) as Route)
}
