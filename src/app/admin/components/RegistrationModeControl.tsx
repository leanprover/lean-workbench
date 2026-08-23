'use client'

import { useRouter } from 'next/navigation'
import { startTransition, useState } from 'react'

import { setRegistrationMode } from '@/app/admin/actions'
import { useServerAction } from '@/lib/client/util'
import type { RegistrationMode } from '@/lib/server/config'

const MODES: { value: RegistrationMode; label: string }[] = [
  { value: 'open', label: 'Open registration' },
  { value: 'restricted', label: 'Restricted (allowlist only)' },
]

export function RegistrationModeControl({ initialMode }: { initialMode: RegistrationMode }) {
  const router = useRouter()
  const [mode, setMode] = useState(initialMode)
  const [savedMode, setSavedMode] = useState(initialMode)

  const [error, saveAction, pending] = useServerAction(setRegistrationMode, () => {
    setSavedMode(mode)
    router.refresh()
  })

  return (
    <>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
        {MODES.map(m => (
          <label key={m.value} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type='radio'
              name='regMode'
              value={m.value}
              checked={mode === m.value}
              onChange={() => setMode(m.value)}
            />
            {m.label}
          </label>
        ))}
      </div>
      {mode !== savedMode && (
        <button onClick={() => startTransition(() => saveAction({ mode }))} disabled={pending}>
          {pending ? 'Saving...' : 'Save'}
        </button>
      )}
      {error && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>{error}</div>}
    </>
  )
}
