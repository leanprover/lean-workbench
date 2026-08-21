'use client'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import ErrorBox from '@/app/components/ErrorBox'
import { useServerAction } from '@/lib/client/util'
import { useConfigCtx } from '@/lib/contexts'
import { type SeedEvent, zSeedEvent } from '@/lib/util'

import { fetchSetupStatus, saveSetupConfig, startSeed } from './actions'

type Phase = 'config' | 'seeding' | 'done' | 'error'

interface SetupFlowProps {
  baseUrl: string
  leanVersions: string[]
  initialSetupStatus: Awaited<ReturnType<typeof fetchSetupStatus>>
}

export default function SetupFlow({ baseUrl, leanVersions, initialSetupStatus }: SetupFlowProps) {
  const cfg = useConfigCtx()
  const [wasCompleteOnMount] = useState(cfg.isSetupComplete)
  // Redirect to index on new visits, but keep the page open during actual setup
  if (wasCompleteOnMount) redirect('/')

  const [configSaved, setConfigSaved] = useState(initialSetupStatus.configSaved)
  const [phase, setPhase] = useState<Phase>(
    initialSetupStatus.seeded ? 'done' : initialSetupStatus.seeding ? 'seeding' : 'config',
  )
  const [seedError, setSeedError] = useState('')
  const [progress, setProgress] = useState({ pct: 0, label: '' })
  const [logs, setLogs] = useState<string[]>([])
  const [leanVersion, setLeanVersion] = useState('LATEST')
  const logRef = useRef<HTMLDivElement>(null)

  const [configError, saveConfigAction, savingConfig] = useServerAction(saveSetupConfig, () => setConfigSaved(true))

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
      let data: SeedEvent
      try {
        data = zSeedEvent.parse(JSON.parse(event.data as string /* EventSources ensure this in practice */))
      } catch (err) {
        source.close()
        console.error('Error parsing a response from EventSource setup-events: ', err)
        setSeedError('Unexpected response from server')
        setPhase('error')
        return
      }

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
      try {
        source.close()
        const status = await fetchSetupStatus()
        if (status.seeded) {
          setProgress({ pct: 100, label: '' })
          setPhase('done')
        } else if (!status.seeding) {
          setSeedError('Connection lost')
          setPhase('error')
        }
      } catch (e) {
        console.error('fetchSetupStatus() failed', e)
        setSeedError('Unexpected error getting setup status')
        setPhase('error')
      }
    }
    return () => source.close()
  }, [phase])

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

      {phase === 'done' ? (
        <div className='setup-done-msg'>
          Setup complete! <Link href='/'>Continue to Lean Workbench</Link>
        </div>
      ) : (
        <>
          {phase !== 'seeding' && (
            <>
              {leanVersions.length === 0 && (
                <ErrorBox>
                  Warning: could not get full list of Lean versions, only &quot;Latest&quot; is available
                </ErrorBox>
              )}

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button className='primary' disabled={!configSaved} onClick={handleStartSeed}>
                  {phase === 'error' ? 'Retry Setup' : 'Start Setup'}
                </button>
                with Lean version:
                <select value={leanVersion} onChange={e => setLeanVersion(e.target.value)}>
                  <option value='LATEST'>Latest</option>
                  {leanVersions.map(v => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {(phase === 'seeding' || phase === 'error') && progress.pct > 0 && (
            <div className='setup-progress'>
              <div className='setup-progress-outer'>
                <div className='setup-progress-inner' style={{ width: `${progress.pct}%` }} />
              </div>
              <div className='setup-progress-label'>
                {phase === 'seeding' && <span className='setup-spinner' />}
                <span>{progress.label || 'Starting...'}</span>
              </div>
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
