'use client'

import { useRouter } from 'next/navigation'
import { startTransition, useRef } from 'react'

import { addAllowedUser, removeAllowedUser } from '@/app/admin/actions'
import { useServerAction } from '@/lib/client/util'
import { formString } from '@/lib/util'

export function AllowlistEditor({ users }: { users: string[] }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  const [addError, addAction, addPending] = useServerAction(
    (formData: FormData) => addAllowedUser({ userName: formString(formData, 'username') }),
    () => {
      if (inputRef.current) inputRef.current.value = ''
      inputRef.current?.focus()
      router.refresh()
    },
  )

  const [removeError, removeAction, removePending] = useServerAction(
    (userName: string) => removeAllowedUser({ userName }),
    () => router.refresh(),
  )

  const error = addError ?? removeError

  return (
    <>
      {users.length === 0 ? (
        <p className='empty'>No users in the allowlist.</p>
      ) : (
        <ul className='project-list'>
          {users.map(u => (
            <li key={u}>
              <div className='info'>{u}</div>
              <div className='actions'>
                <button
                  className='delete'
                  disabled={removePending}
                  onClick={() => startTransition(() => removeAction(u))}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form action={addAction} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input
          ref={inputRef}
          type='text'
          name='username'
          placeholder='GitHub username'
          style={{ flex: 1 }}
          disabled={addPending}
        />
        <button type='submit' disabled={addPending}>
          Add
        </button>
      </form>
      {error && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>{error}</div>}
    </>
  )
}
