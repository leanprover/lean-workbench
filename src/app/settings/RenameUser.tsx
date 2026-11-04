'use client'

import { useState } from 'react'

import { useReloadSession } from '@/lib/client/auth'
import { useServerAction } from '@/lib/client/util'
import { type User } from '@/lib/server/auth'

import { setDisplayName } from './actions'

export function RenameUser({ user }: Readonly<{ user: User }>) {
  const [renaming, setRenaming] = useState(false)
  return renaming ? (
    <RenameUserForm user={user} close={() => setRenaming(false)} />
  ) : (
    <div style={{ display: 'grid', alignItems: 'center', gridTemplateColumns: '1fr max-content' }}>
      <span>Display name: {user.displayName ?? '(none)'}</span>
      <button onClick={() => setRenaming(true)}>Edit</button>
    </div>
  )
}

export function RenameUserForm({ user, close }: Readonly<{ user: User; close: () => void }>) {
  const reloadSession = useReloadSession()
  const [setDisplayError, setDisplayAction, setDisplayPending] = useServerAction(setDisplayName, async () => {
    close()
    await reloadSession()
  })

  return (
    <>
      <form action={setDisplayAction} style={{ display: 'grid', gridTemplateColumns: '1fr max-content max-content' }}>
        <input name='displayName' type='text' defaultValue={user.displayName ?? ''} />
        <button type='button' onClick={() => close()}>
          Cancel
        </button>
        <button type='submit' disabled={setDisplayPending}>
          Submit
        </button>
      </form>
      {setDisplayError && <div style={{ color: '#dc2626', fontSize: 13 }}>{setDisplayError}</div>}
    </>
  )
}
