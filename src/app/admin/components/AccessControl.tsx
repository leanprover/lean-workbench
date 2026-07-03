import { getConfig } from '@/lib/server/config'
import { getDb } from '@/lib/server/db'

import { AllowlistEditor } from './AllowlistEditor'
import { RegistrationModeControl } from './RegistrationModeControl'

export async function AccessControl() {
  const mode = getConfig().registrationMode
  const allowed =
    mode === 'restricted' ? await getDb().allowedGithubUser.findMany({ orderBy: { githubUsername: 'asc' } }) : []
  return (
    <>
      <section>
        <h2>Access control</h2>
        <RegistrationModeControl initialMode={mode} />
      </section>
      {mode === 'restricted' && (
        <section>
          <h3>Allowed users</h3>
          <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: 12 }}>GitHub usernames allowed to register.</p>
          <AllowlistEditor users={allowed.map(u => u.githubUsername)} />
        </section>
      )}
    </>
  )
}
