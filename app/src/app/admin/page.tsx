import { AdminPanel } from './AdminPanel'
import { requireAdmin } from './actions'

export default async function AdminPage() {
  const session = await requireAdmin()
  return <AdminPanel currentUserId={session.user.id} />
}
