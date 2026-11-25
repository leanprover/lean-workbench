import { zProjectName, zUserName } from '@leanprover/workbench-shared'
import { getProjectDir } from '@leanprover/workbench-shared/node'
import { type Route } from 'next'
import { notFound, redirect } from 'next/navigation'
import { connection } from 'next/server'
import z from 'zod'

import { ErrorBox } from '@/app/components/ErrorBox'
import { requireAuth } from '@/lib/server/auth'
import { getConfig, isPublishingEnabled } from '@/lib/server/config'
import { publicationUrl } from '@/lib/server/publish'
import { getProjectForViewer } from '@/lib/server/util'
import { detectViews, VIEWS } from '@/lib/server/views'

export const instant = false

const zParams = z.object({
  userName: zUserName,
  projectName: zProjectName,
  kind: z.string(),
})

type Params = z.infer<typeof zParams>

/** Show an alternate view of a workbench project.
 *
 * A view that doesn't have a live component redirects to the publication on the publish origin.
 * A view that does have a live component needs an account that can read the project. */
export default async function ViewPage({ params: params_ }: { params: Promise<Params> }) {
  // Reading the project directory is too expensive for prerendering or a <Link> prefetch.
  await connection()

  const parsed = zParams.safeParse(await params_)
  // 400 would be better, but RSCs can't return a Response and there is no 400 helper in Next.js.
  if (!parsed.success) notFound()
  const { userName, projectName, kind } = parsed.data

  const definition = VIEWS.find(v => v.id === kind)
  if (!definition) notFound()

  if (!definition.live) {
    if (!definition.plan || !isPublishingEnabled(getConfig())) notFound()
    redirect(publicationUrl(userName, projectName, kind) as Route)
  }

  const session = await requireAuth()

  const proj = await getProjectForViewer(session.user, userName, projectName)
  if (!proj) notFound() // 404 rather than 403 to avoid leaking the existence of inaccessible projects.
  const { owner, project } = proj

  const manifest = await detectViews(getProjectDir(owner, project.id))
  if (manifest.type === 'invalid') return <ErrorBox>{manifest.error}</ErrorBox>
  const view = manifest.type === 'declared' ? manifest.views.find(v => v.id === kind) : undefined
  // The declaration is what enables a view on a project, registry entry or not.
  if (!view) notFound()
  if ('error' in view) return <ErrorBox>{view.error}</ErrorBox>

  // No view is live yet, so nothing reaches this.
  notFound()
}
