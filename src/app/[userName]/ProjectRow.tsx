'use client'

import { type Route } from 'next'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { startTransition, useState } from 'react'
import { Button, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components'

import MenuLinkItem from '@/app/components/MenuLinkItem'
import { useServerAction } from '@/lib/client/util'

import { deleteProject, type ProjectInfo, renameProject, toggleVisibility } from './actions'

export function ProjectRow({
  project,
  username,
  canPublish,
}: {
  project: ProjectInfo
  username: string
  /** Whether the project declares a publish manifest; if not, it has no publish page to link to. */
  canPublish: boolean
}) {
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
          <div style={{ overflowX: 'visible', textBox: 'normal' }}>
            <input type='hidden' name='projectId' value={project.id} />
            <input
              name='name'
              type='text'
              defaultValue={project.name}
              onKeyDown={e => {
                if (e.key === 'Escape') setRenaming(false)
              }}
              placeholder='Project name'
              style={{ width: '100%' }}
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
          {renameError && <div style={{ color: '#dc2626', fontSize: 13 }}>{renameError}</div>}
        </form>
      </>
    )
  }

  const actionPending = deletePending || visibilityPending
  const error = deleteError ?? visibilityError

  return (
    <>
      <div>
        <Link href={`/${username}/${encodeURIComponent(project.name)}/` as Route}>{project.name}</Link>
        {project.isPublic && (
          <>
            {' '}
            <span
              role='img'
              aria-label='Project is publicly editable'
              title='Project is publicly editable by any logged-in user'
              style={{ cursor: 'default' }}
            >
              🌐
            </span>
          </>
        )}
      </div>
      <div className='actions'>
        <MenuTrigger>
          <Button style={{ padding: 5, fontSize: 20 }}>⚙️</Button>
          <Popover className='avatar-dropdown' placement='end top' offset={4}>
            <Menu>
              <MenuItem
                onAction={() => {
                  startTransition(() => visibilityAction({ projectId: project.id, isPublic: !project.isPublic }))
                }}
                isDisabled={actionPending}
              >
                {project.isPublic ? 'Make private' : 'Make public'}
              </MenuItem>
              {canPublish && (
                <MenuLinkItem href={`/${username}/${encodeURIComponent(project.name)}/publish`}>Publish</MenuLinkItem>
              )}
              <MenuItem onAction={() => setRenaming(true)} isDisabled={actionPending}>
                Rename
              </MenuItem>
              <MenuItem
                onAction={() => {
                  if (!confirm(`Delete project "${project.name}"? Project files will be kept.`)) return
                  startTransition(() => deleteAction({ projectId: project.id }))
                }}
                isDisabled={actionPending}
              >
                Delete
              </MenuItem>
            </Menu>
          </Popover>
        </MenuTrigger>
      </div>
      {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}{' '}
    </>
  )
}
