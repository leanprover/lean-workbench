import { io } from 'next/cache'

import { requireAdmin } from '@/lib/server/auth'
import { getDb } from '@/lib/server/db'

import { UserRow } from './UserRow'

export async function UserManagement() {
  await io()
  const session = await requireAdmin()

  const db = getDb()
  const users = await db.user.findMany({
    select: { id: true, name: true, isAdmin: true },
    orderBy: { createdAt: 'asc' },
  })
  return (
    <section>
      <h2>Registered users</h2>
      {users.length === 0 ? (
        <p className='empty'>No users.</p>
      ) : (
        <ul className='project-list'>
          {users.map(u => (
            <UserRow key={u.id} user={u} isSelf={u.id === session.user.id} />
          ))}
        </ul>
      )}
    </section>
  )
}
