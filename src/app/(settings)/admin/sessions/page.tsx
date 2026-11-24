import { requireAdmin } from '@/lib/server/auth'

import { SessionViewer } from './SessionViewer'

export const instant = false
export default async function AdminSessions() {
  await requireAdmin()

  return (
    <div className='admin-page'>
      <h1>Editor sessions</h1>
      <SessionViewer />
    </div>
  )
}
