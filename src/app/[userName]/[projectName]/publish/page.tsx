import { zProjectName, zUserName } from '@leanprover/workbench-shared'
import { getProjectDir } from '@leanprover/workbench-shared/node'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import z from 'zod'

import ErrorBox from '@/app/components/ErrorBox'
import { detectPublishable, PUBLISH_MANIFEST_FILE } from '@/lib/server/artefacts'
import { getDb } from '@/lib/server/db'
import { durablePublicationUrl, publicationUrl, publishTrackingKey } from '@/lib/server/publish'
import { requireProjectOwner } from '@/lib/server/util'

import { type PublicationInfo, PublishCard } from './PublishCard'

const zParams = z.object({
  userName: zUserName,
  projectName: zProjectName,
})

type Params = z.infer<typeof zParams>

/** Rendered on the server so that it does not depend on the visitor's locale. */
const formatPublishedAt = (at: Date) => `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`

export default async function PublishPage({ params: params_ }: { params: Promise<Params> }) {
  // Reading the project directory is too expensive for prerendering or a <Link> prefetch.
  await connection()

  const parsed = zParams.safeParse(await params_)
  // 400 would be better, but RSCs can't return a Response and there is no 400 helper in Next.js.
  if (!parsed.success) notFound()
  const { userName, projectName } = parsed.data

  const { owner, project } = await requireProjectOwner(userName, projectName)
  const manifest = await detectPublishable(getProjectDir(owner, project.id))
  // A project that declares no manifest has no publishing interface at all.
  if (manifest.type === 'missing') notFound()
  const publications = await getDb().publication.findMany({ where: { projectId: project.id } })

  const publicationFor = (kind: string): PublicationInfo | undefined => {
    const publication = publications.find(p => p.kind === kind)
    if (!publication) return undefined
    return {
      url: publicationUrl(owner.name, project.name, kind),
      durableUrl: durablePublicationUrl(publication.id),
      publishedAt: formatPublishedAt(publication.updatedAt),
    }
  }

  return (
    <>
      <h1>Publish {project.name}</h1>

      {manifest.type === 'invalid' && <ErrorBox>{manifest.error}</ErrorBox>}

      {manifest.type === 'declared' && manifest.artefacts.length === 0 && (
        <p className='empty'>
          <code>{PUBLISH_MANIFEST_FILE}</code> declares nothing this workbench knows how to publish.
        </p>
      )}

      {manifest.type === 'declared' &&
        manifest.artefacts.map(artefact => (
          <PublishCard
            key={artefact.id}
            userName={owner.name}
            projectName={project.name}
            kind={artefact.id}
            displayName={artefact.displayName}
            detail={'error' in artefact ? { error: artefact.error } : { description: artefact.description }}
            publication={publicationFor(artefact.id)}
            trackingKey={publishTrackingKey(project.id, artefact.id)}
          />
        ))}
    </>
  )
}
