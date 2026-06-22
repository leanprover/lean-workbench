import { requireAuth } from '@/lib/server/auth'
import { getProjectDir } from '@/lib/server/config'
import { getDb } from '@/lib/server/db'
import { mintSignedDirToken, signedDirFileUrl } from '@/lib/server/dirToken'
import { canAccessProject } from '@/lib/server/util'
import { zProjectName, zUserName } from '@/lib/util'
import type { Route } from 'next'
import { notFound, redirect } from 'next/navigation'
import z from 'zod'

const zParams = z.object({
  userName: zUserName,
  projectName: zProjectName,
  /** Project-relative path to the file to preview, split into URL segments. */
  relPath: z
    .array(z.string().refine(s => !['', '.', '..'].includes(s) && !s.includes('/'), 'Invalid path segment'))
    .min(1),
})

type Params = z.infer<typeof zParams>

/** Redirect to a `/_file/` URL serving a file in the project folder.
 * Access control is currently the same as for editing the project. */
export async function GET(_req: Request, { params }: { params: Promise<Params> }) {
  const parsed = zParams.safeParse(await params)
  if (!parsed.success) return new Response(parsed.error.issues[0].message, { status: 400 })
  const { userName, projectName, relPath: relPathSegs } = parsed.data

  const session = await requireAuth()

  const db = getDb()
  const owner = await db.user.findUnique({ where: { name: userName } })
  if (!owner) notFound()
  const project = await db.project.findUnique({
    where: { userId_name: { userId: owner.id, name: projectName } },
  })
  // 404 rather than 403 to avoid leaking the existence of inaccessible projects.
  if (!project || !canAccessProject(session.user, project)) notFound()

  // Mint a token with the the project folder as root dir:
  // viewer can already read these same files through the editor.
  const rootDir = getProjectDir(owner.name, project.id)
  redirect(signedDirFileUrl(mintSignedDirToken(rootDir), relPathSegs.join('/')) as Route)
}
