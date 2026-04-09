import { createRoot } from 'react-dom/client'
import { ProfilePage } from './ProfilePage'

declare global {
  interface Window {
    __DATA__: { username: string; isAdmin: boolean; isOwner: boolean }
  }
}

const { username, isAdmin, isOwner } = window.__DATA__

createRoot(document.getElementById('root')!).render(
  <ProfilePage username={username} isAdmin={isAdmin} isOwner={isOwner} />,
)
