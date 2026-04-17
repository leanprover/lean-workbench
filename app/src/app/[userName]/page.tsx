import { requireAuth } from '@/lib/server/actions'
import { getDb } from '@/lib/server/db'
import { Route } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { NewProjectForm } from './NewProjectForm'
import { ProjectRow } from './ProjectRow'

export default async function ProfilePage({ params }: { params: Promise<{ userName: string }> }) {
  const viewerSession = await requireAuth()

  const { userName } = await params
  const db = getDb()
  const user = await db.user.findUnique({ where: { name: userName } })
  if (!user) notFound()

  const isOwner = viewerSession.user.name === userName
  const projects = await db.project.findMany({
    where: { userId: user.id, ...(isOwner ? {} : { isPublic: true }) },
    select: { id: true, name: true, isPublic: true },
    orderBy: { createdAt: 'asc' },
  })

  return (
    <>
      <h1>{userName}&apos;s projects</h1>
      {projects.length === 0 ? (
        <p className='empty'>{isOwner ? 'No projects yet. Create one below.' : 'No public projects.'}</p>
      ) : (
        <ul className='project-list'>
          {projects.map(p => (
            <li key={p.id}>
              {isOwner ? (
                <ProjectRow project={p} username={userName} />
              ) : (
                <div className='info'>
                  <Link href={`/${userName}/${encodeURIComponent(p.name)}/` as Route}>{p.name}</Link>
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
