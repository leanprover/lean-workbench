import { requireAdmin } from '@/lib/server/auth'

import SetupFlow from './SetupFlow'

export const instant = false

export default async function Setup() {
  await requireAdmin() // redirects to ./unauthorized.tsx for login
  return (
    <>
      <h1>Setup Data Volume</h1>
      <p style={{ color: '#607D8B', fontSize: '13px' }}>
        Install elan and set up an initial project template. This may take several minutes.
      </p>
      <SetupFlow />
    </>
  )
}
