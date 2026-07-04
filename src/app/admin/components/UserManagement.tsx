import { requireAdmin } from '@/app/admin/actions'
import { getDb } from '@/lib/server/db'

import { UserRow } from './UserRow'

export async function UserManagement() {
  const [users, session] = await Promise.all([
    getDb().user.findMany({
      select: { id: true, name: true, isAdmin: true },
      orderBy: { createdAt: 'asc' },
    }),
    requireAdmin(),
  ])
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
