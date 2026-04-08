import { createRoot } from 'react-dom/client'
import { AdminPage } from './AdminPage.tsx'

declare global {
  interface Window {
    __DATA__: { username: string }
  }
}

const { username } = window.__DATA__

createRoot(document.getElementById('root')!).render(<AdminPage username={username} />)
