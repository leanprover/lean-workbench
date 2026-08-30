'use client'

import { LEAN_VERSION_RE } from '@leanprover/workbench-shared'
import { redirect, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import z from 'zod'

import { useServerAction, useThrowingSWR, useThrowToBoundary } from '@/lib/client/util'
import { useConfigCtx } from '@/lib/contexts'

import { doSeed, fetchSetupStatus, saveSetupConfig } from './actions'
import TrackedCommandForm from './TrackedCommandForm'

/** Fetch mathlib4 v4.* tags, newest-first, paginating until exhausted. */
async function fetchLeanVersions(): Promise<string[]> {
  const versions: string[] = []
  // This relies on version tags being returned first.
  const res: Response = await fetch('https://api.github.com/repos/leanprover-community/mathlib4/tags?per_page=100')
  if (!res.ok) throw new Error(`GitHub API ${res.status}`)
  const data = z.array(z.object({ name: z.string() })).parse(await res.json())
  for (const item of data) if (LEAN_VERSION_RE.test(item.name)) versions.push(item.name)
  return versions
}

interface SetupFlowProps {
  baseUrl: string
}

export default function SetupFlow({ baseUrl }: SetupFlowProps) {
  const router = useRouter()
  const cfg = useConfigCtx()
  const [wasCompleteOnMount] = useState(cfg.isSetupComplete)
  // Redirect to index on new visits, but keep the page open during actual setup
  if (wasCompleteOnMount) redirect('/')

  const [configSaved, setConfigSaved] = useState(false)
  const { data: leanVersions } = useThrowingSWR('leanVersions', fetchLeanVersions)

  const [configError, saveConfigAction, savingConfig] = useServerAction(saveSetupConfig, () => setConfigSaved(true))

  // Sync with server state on mount (handles page reload during seeding).
  const { throwToBoundary } = useThrowToBoundary()
  useEffect(() => {
    fetchSetupStatus().then(status => {
      if (status.configSaved) setConfigSaved(true)
    }, throwToBoundary)
  }, [throwToBoundary])

  return (
    <>
      <h1>Setup</h1>
      <h2>Configuration</h2>
      {configSaved ? (
        <div className='setup-done-msg'>Configuration saved.</div>
      ) : (
        <form action={saveConfigAction} className='setup-form'>
          <h3>GitHub Authentication</h3>
          <p style={{ color: '#607D8B', fontSize: '13px' }}>
            Create a{' '}
            <a href='https://github.com/settings/developers' target='_blank' rel='noreferrer'>
              GitHub OAuth App
            </a>
            . When prompted, set the &quot;Redirect URI&quot; to
          </p>
          <code>{`${baseUrl}/api/auth/callback/github`}</code>
          <p style={{ color: '#607D8B', fontSize: '13px' }}>
            Then enter the client ID and secret of your OAuth App here.
          </p>
          <div className='setup-field'>
            <label htmlFor='clientId'>Client ID</label>
            <input type='text' id='clientId' name='clientId' placeholder='Ov23li...' autoComplete='off' required />
          </div>
          <div className='setup-field'>
            <label htmlFor='clientSecret'>Client Secret</label>
            <input type='password' id='clientSecret' name='clientSecret' placeholder='Enter client secret' required />
          </div>
          <button type='submit' className='primary' disabled={savingConfig}>
            {savingConfig ? 'Saving...' : 'Save Configuration'}
          </button>
        </form>
      )}

      {configError && <div className='setup-error-msg'>{configError}</div>}

      <hr className='setup-divider' />

      <h2>Initialize Data Volume</h2>
      <p style={{ color: '#607D8B', fontSize: '13px' }}>
        Install elan, download pre-compiled Mathlib, and set up project templates. This may take several minutes.
      </p>

      <TrackedCommandForm
        streamCommandKey='seed'
        disabled={!configSaved}
        title='Start Setup'
        trackedCommandAction={doSeed}
        successButtonText='Continue to Lean Workbench'
        successButtonAction={() => {
          router.refresh()
          router.push('/')
        }}
      >
        <label>
          Lean version:{' '}
          <select name='leanVersion' disabled={!leanVersions}>
            <option>{leanVersions ? 'Latest' : 'Loading…'}</option>
            {leanVersions?.map(v => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </TrackedCommandForm>
    </>
  )
}
