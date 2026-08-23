'use client'

import { type Route } from 'next'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { startTransition, useState } from 'react'

import { useServerAction } from '@/lib/client/util'

import { deleteProject, type ProjectInfo, renameProject, toggleVisibility } from './actions'

export function ProjectRow({ project, username }: { project: ProjectInfo; username: string }) {
  const router = useRouter()
  const [renaming, setRenaming] = useState(false)

  const [renameError, renameAction, renamePending] = useServerAction(renameProject, () => {
    setRenaming(false)
    router.refresh()
  })

  const [deleteError, deleteAction, deletePending] = useServerAction(deleteProject, () => router.refresh())

  const [visibilityError, visibilityAction, visibilityPending] = useServerAction(toggleVisibility, () =>
    router.refresh(),
  )

  if (renaming) {
    return (
      <>
        <form action={renameAction} style={{ display: 'contents' }}>
          <input type='hidden' name='projectId' value={project.id} />
          <div className='info' style={{ flex: 1 }}>
            <input
              name='name'
              type='text'
              defaultValue={project.name}
              onKeyDown={e => {
                if (e.key === 'Escape') setRenaming(false)
              }}
              placeholder='Project name'
              style={{ width: '100%', marginBottom: 4 }}
              disabled={renamePending}
              autoFocus
            />
          </div>
          <div className='actions'>
            <button type='submit' disabled={renamePending}>
              Save
            </button>
            <button type='button' onClick={() => setRenaming(false)} disabled={renamePending}>
              Cancel
            </button>
          </div>
        </form>
        {renameError && <div style={{ color: '#dc2626', fontSize: 13 }}>{renameError}</div>}
      </>
    )
  }

  const actionPending = deletePending || visibilityPending
  const error = deleteError ?? visibilityError

  return (
    <>
      <div className='info'>
        <Link href={`/${username}/${encodeURIComponent(project.name)}/` as Route}>{project.name}</Link>
      </div>
      <div className='actions'>
        <button
          onClick={() => {
            startTransition(() => visibilityAction({ projectId: project.id, isPublic: !project.isPublic }))
          }}
          disabled={actionPending}
        >
          {project.isPublic ? 'Make private' : 'Make public'}
        </button>
        <button onClick={() => setRenaming(true)} disabled={actionPending}>
          Rename
        </button>
        <button
          className='delete'
          onClick={() => {
            if (!confirm(`Delete project "${project.name}"? Project files will be kept.`)) return
            startTransition(() => deleteAction({ projectId: project.id }))
          }}
          disabled={actionPending}
        >
          Delete
        </button>
      </div>
      {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
    </>
  )
}
