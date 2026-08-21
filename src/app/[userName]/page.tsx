import { zUserName } from '@leanprover/workbench-shared'
import { type Route } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import z from 'zod'

import { requireAuth } from '@/lib/server/auth'
import { getDb } from '@/lib/server/db'

import { NewProjectForm } from './NewProjectForm'
import { ProjectRow } from './ProjectRow'

const zParams = z.object({
  userName: zUserName,
})

type Params = z.infer<typeof zParams>

export default async function ProfileBody({ params: params_ }: { params: Promise<Params> }) {
  const parsed = zParams.safeParse(await params_)
  // 400 would be better, but RSCs can't return a Response and there is no 400 helper in Next.js.
  if (!parsed.success) notFound()
  const { userName } = parsed.data

  const viewerSession = await requireAuth()

  const db = getDb()
  const user = await db.user.findUnique({ where: { name: userName } })
  if (!user) notFound()

  const isOwner = viewerSession.user.id === user.id
  const projects = await db.project.findMany({
    where: { userId: user.id, ...(isOwner ? {} : { isPublic: true }) },
    select: { id: true, name: true, isPublic: true },
    orderBy: { createdAt: 'asc' },
  })

  return (
    <>
      <h1>{user.name}&apos;s projects</h1>
      {projects.length === 0 ? (
        <p className='empty'>{isOwner ? 'No projects yet. Create one below.' : 'No public projects.'}</p>
      ) : (
        <ul className='project-list'>
          {projects.map(p => (
            <li key={p.id}>
              {isOwner ? (
                <ProjectRow project={p} username={user.name} />
              ) : (
                <div className='info'>
                  <Link href={`/${user.name}/${encodeURIComponent(p.name)}/` as Route}>{p.name}</Link>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {isOwner && <NewProjectForm />}
    </>
  )
}
