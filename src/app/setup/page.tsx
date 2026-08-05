'use client'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { z } from 'zod'

import { useServerAction } from '@/lib/client/util'
import { useConfigCtx } from '@/lib/contexts'
import { LEAN_VERSION_RE, zSeedEvent } from '@/lib/util'

import { fetchSetupStatus, saveSetupConfig, startSeed } from './actions'

type Phase = 'config' | 'seeding' | 'done' | 'error'

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

export default function Setup() {
  const cfg = useConfigCtx()
  const [wasCompleteOnMount] = useState(cfg.isSetupComplete)
  // Redirect to index on new visits, but keep the page open during actual setup
  if (wasCompleteOnMount) redirect('/')

  const [configSaved, setConfigSaved] = useState(false)
  const [phase, setPhase] = useState<Phase>('config')
  const [seedError, setSeedError] = useState('')
  const [progress, setProgress] = useState({ pct: 0, label: '' })
  const [logs, setLogs] = useState<string[]>([])
  const [leanVersion, setLeanVersion] = useState<string | undefined>()
  const { data: leanVersions } = useSWR('leanVersions', fetchLeanVersions)
  const logRef = useRef<HTMLDivElement>(null)

  const [configError, saveConfigAction, savingConfig] = useServerAction(
    (formData: FormData) => saveSetupConfig(formData),
    () => setConfigSaved(true),
  )

  // Sync with server state on mount (handles page reload during seeding).
  useEffect(() => {
    fetchSetupStatus().then(status => {
      if (status.configSaved) setConfigSaved(true)
      if (status.seeded) setPhase('done')
      else if (status.seeding) setPhase('seeding')
    })
  }, [])

  // Auto-scroll log area.
  useEffect(() => {
    const el = logRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [logs])

  // Stream seed events whenever we're in the seeding phase.
  useEffect(() => {
    if (phase !== 'seeding') return
    const source = new EventSource('/api/setup-events')
    source.onmessage = event => {
      const data = zSeedEvent.parse(JSON.parse(event.data as string /* EventSources ensure this in practice */))
      switch (data.type) {
        case 'progress': {
          const pct = Math.round((data.step / data.total) * 100)
          setProgress({ pct, label: `${data.label} (${data.step}/${data.total})` })
          break
        }
        case 'log': {
          setLogs(prev => [...prev, data.line])
          break
        }
        case 'done': {
          source.close()
          setProgress({ pct: 100, label: '' })
          setPhase('done')
          break
        }
        case 'error': {
          source.close()
          setSeedError(data.message)
          setPhase('error')
          break
        }
      }
    }
    source.onerror = async () => {
      source.close()
      const status = await fetchSetupStatus()
      if (status.seeded) {
        setProgress({ pct: 100, label: '' })
        setPhase('done')
      } else if (!status.seeding) {
        setSeedError('Connection lost')
        setPhase('error')
      }
    }
    return () => source.close()
  }, [phase])

  const [origin, setOrigin] = useState('')
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin)
  }, [])

  async function handleStartSeed() {
    setSeedError('')
    setLogs([])
    setProgress({ pct: 0, label: 'Starting...' })
    setPhase('seeding')
    const result = await startSeed(leanVersion)
    if ('error' in result) {
      setSeedError(result.error)
      setPhase('error')
    }
  }

  return (
    <>
      <h1>Setup</h1>
      <h2>Step 1: Configuration</h2>
      {configSaved ? (
        <div className='setup-done-msg'>Configuration saved.</div>
      ) : (
        <form action={saveConfigAction} className='setup-form'>
          <h3>Domain configuration</h3>
          <p style={{ color: '#607D8B', fontSize: '13px' }}>
            Provide the URL on which you will host the Lean Workbench, for example <code>https://myserver.com</code>.
          </p>
          <div className='setup-field'>
            <input
              type='url'
              id='baseUrl'
              name='baseUrl'
              value={origin}
              onChange={e => setOrigin(e.target.value)}
              required
            />
          </div>
          <h3>GitHub Authentication</h3>
          <p style={{ color: '#607D8B', fontSize: '13px' }}>
            Create a{' '}
            <a href='https://github.com/settings/developers' target='_blank' rel='noreferrer'>
              GitHub OAuth App
            </a>
            . When prompted, set the &quot;Authorization callback URL&quot; to
          </p>
          <code>{origin && `${origin}/api/auth/callback/github`}</code>
          <p style={{ color: '#607D8B', fontSize: '13px' }}>
            Then enter the client ID and secret of your OAuth App here.
          </p>
          <div className='setup-field'>
            <label htmlFor='clientId'>Client ID</label>
            <input type='text' id='clientId' name='clientId' placeholder='Ov23li...' required />
          </div>
          <div className='setup-field'>
            <label htmlFor='clientSecret'>Client Secret</label>
            <input
              type='password'
              id='clientSecret'
              name='clientSecret'
              placeholder='Enter client secret'
              autoComplete='off'
              required
            />
          </div>
          <button type='submit' className='primary' disabled={savingConfig}>
            {savingConfig ? 'Saving...' : 'Save Configuration'}
          </button>
        </form>
      )}

      {configError && <div className='setup-error-msg'>{configError}</div>}

      <hr className='setup-divider' />

      <h2>Step 2: Initialize Data Volume</h2>
      <p style={{ color: '#607D8B', fontSize: '13px' }}>
        Install elan, download pre-compiled Mathlib, and set up project templates. This may take several minutes.
      </p>

      {phase === 'done' ? (
        <div className='setup-done-msg'>
          Setup complete! <Link href='/'>Continue to Lean Workbench</Link>
        </div>
      ) : (
        <>
          {phase !== 'seeding' && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button className='primary' disabled={!configSaved} onClick={handleStartSeed}>
                {phase === 'error' ? 'Retry Setup' : 'Start Setup'}
              </button>
              with Lean version:
              <select
                value={leanVersion ?? ''}
                onChange={e => setLeanVersion(e.target.value || undefined)}
                disabled={!leanVersions}
              >
                <option>{leanVersions ? 'Latest' : 'Loading…'}</option>
                {leanVersions?.map(v => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          )}

          {(phase === 'seeding' || phase === 'error') && progress.pct > 0 && (
            <div className='setup-progress'>
              <div className='setup-progress-outer'>
                <div className='setup-progress-inner' style={{ width: `${progress.pct}%` }} />
              </div>
              {(phase === 'seeding' || phase === 'error') && (
                <div className='setup-progress-label'>
                  {phase === 'seeding' && <span className='setup-spinner' />}
                  <span>{progress.label || 'Starting...'}</span>
                </div>
              )}
            </div>
          )}

          {(phase === 'seeding' || phase === 'error') && logs.length > 0 && (
            <div className='setup-log' ref={logRef}>
              {logs.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}

          {seedError && <div className='setup-error-msg'>Setup failed: {seedError}</div>}
        </>
      )}
    </>
  )
}
