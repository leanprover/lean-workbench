import { AvatarIcon } from '@/app/components/AvatarIcon'
import { requireAuth } from '@/lib/server/auth'

import { EditAvatar } from './EditAvatar'
import { RenameUser } from './RenameUser'

export const instant = false
export default async function SettingsPage() {
  const session = await requireAuth()

  return (
    <>
      <h1>User settings</h1>
      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: '1fr max-content' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ borderBottom: '1px solid #e4ebf3', paddingBlock: 4 }}>
            Username: <code>{session.user.name}</code>
          </div>
          <RenameUser user={session.user} />
        </div>
        <div>
          <div style={{ position: 'relative' }}>
            <AvatarIcon user={session.user} size={128} />
            <div style={{ position: 'absolute', right: 0, bottom: 0 }}>
              <EditAvatar user={session.user} />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
