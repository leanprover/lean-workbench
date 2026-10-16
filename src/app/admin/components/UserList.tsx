'use client'

import { QuickFilterInput, useQuickFilter } from '@/app/components/QuickFilterInput'
import { type User } from '@/lib/server/auth'

import { UserRow } from './UserRow'

export function UserList(props: { users: Pick<User, 'name' | 'id' | 'isAdmin'>[]; selfId: string }) {
  const { filter, matchesFilter } = useQuickFilter()
  const filtered = props.users.filter(user => matchesFilter(user.name) || matchesFilter(user.id))

  return (
    <>
      <div className='filter'>
        <QuickFilterInput description='Filter users' filter={filter} />
      </div>
      {filtered.length === 0 && <p className='empty'>No users match the filter.</p>}
      <ul className='action-list'>
        {filtered.map(u => (
          <UserRow key={u.id} user={u} isSelf={u.id === props.selfId} />
        ))}
      </ul>
    </>
  )
}
