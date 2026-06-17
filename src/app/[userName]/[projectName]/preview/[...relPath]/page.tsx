import Error from '@/app/components/Error'
import ProjectLink from '@/app/components/ProjectLink'
import { requireAuth } from '@/lib/server/auth'
import { getWorkspacesDir } from '@/lib/server/config'
import { getDb } from '@/lib/server/db'
import { mintSignedDirToken, signedDirFileUrl } from '@/lib/server/dirToken'
import { canAccessProject } from '@/lib/server/util'
import { zProjectName, zUserName } from '@/lib/util'
import { notFound } from 'next/navigation'
import fs from 'node:fs/promises'
import path from 'node:path'
import z from 'zod'

const zParams = z.object({
  userName: zUserName,
  projectName: zProjectName,
  /** Project-relative path to the previewed file, split into URL segments. */
  relPath: z
    .array(z.string().refine(s => !['', '.', '..'].includes(s) && !s.includes('/'), 'Invalid path segment'))
    .min(1),
})

type Params = z.infer<typeof zParams>

/** Renders a file from the project's workspace in a sandboxed iframe.
 * Access control is currently the same as for editing the project. */
export default async function Preview({ params: params_ }: { params: Promise<Params> }) {
  const parsed = zParams.safeParse(await params_)
  // 400 would be better, but RSCs can't return a Response and there is no 400 helper in Next.js.
  if (!parsed.success) notFound()
  const params = parsed.data

  const session = await requireAuth()

  const db = getDb()
  const owner = await db.user.findUnique({
    where: { name: params.userName },
  })
  if (!owner) notFound()

  const project = await db.project.findUnique({
    where: { userId_name: { userId: owner.id, name: params.projectName } },
  })
  if (!project || !canAccessProject(session.user, project)) notFound()

  // The token's root dir is the project folder:
  // the same files the viewer can already read through the editor.
  const rootDir = await fs.realpath(path.join(getWorkspacesDir(), owner.name, project.id))
  const relPath = params.relPath.join('/')
  const stat = await fs.stat(path.join(rootDir, relPath)).catch(() => null)
  if (!stat) {
    return (
      <Error>
        File &quot;{relPath}&quot; not found in project{' '}
        <ProjectLink ownerUsername={owner.name} projectName={project.name} />.
      </Error>
    )
  }

  const src = signedDirFileUrl(mintSignedDirToken(rootDir), relPath)
  // TODO: synchronize iframe URL with top-level URL.
  // `sandbox` and the /_file/ route's CSP header redundantly enforce an opaque origin.
  return <iframe sandbox='allow-scripts' className='editor-session-iframe' src={src} />
}
