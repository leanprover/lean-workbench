import { io } from 'next/cache'

import { requireAdmin } from '@/lib/server/auth'
import { getDb } from '@/lib/server/db'

import { UserList } from './UserList'

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
      <h2 className='with-filter'>Registered users</h2>
      <UserList users={users} selfId={session.user.id} />
    </section>
  )
}
