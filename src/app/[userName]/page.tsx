import { requireAuth } from '@/lib/server/actions'
import { getDb } from '@/lib/server/db'
import { Route } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { NewProjectForm } from './NewProjectForm'
import { ProjectRow } from './ProjectRow'

interface Params {
  userName: string
}

export default function ProfilePage({ params }: { params: Promise<Params> }) {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <ProfileBody params={params} />
    </Suspense>
  )
}

async function ProfileBody({ params }: { params: Promise<Params> }) {
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
