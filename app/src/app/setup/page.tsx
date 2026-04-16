'use client'

import { ConfigCtx } from '@/lib/contexts'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { useContext, useEffect, useRef, useState } from 'react'
import { fetchSetupStatus, saveSetupConfig, startSeed } from './actions'

type Phase = 'config' | 'seeding' | 'done' | 'error'

function connectStream(handlers: {
  onProgress: (pct: number, label: string) => void
  onLog: (line: string) => void
  onDone: () => void
  onError: (msg: string) => void
}) {
  const source = new EventSource('/api/setup-events')
  source.onmessage = event => {
    const data = JSON.parse(event.data)
    if (data.type === 'progress') {
      const pct = Math.round((data.step / data.total) * 100)
      handlers.onProgress(pct, `${data.label} (${data.step}/${data.total})`)
    } else if (data.type === 'log') {
      handlers.onLog(data.line)
    } else if (data.type === 'done') {
      source.close()
      handlers.onDone()
    } else if (data.type === 'error') {
      source.close()
      handlers.onError(data.message)
    }
  }
  source.onerror = () => {
    source.close()
    fetchSetupStatus().then(status => {
      if (status.seeded) handlers.onDone()
      else if (!status.seeding) handlers.onError('Connection lost')
    })
  }
}

function CallbackLink() {
  const [url, setUrl] = useState<string>('')
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(window.location.origin + '/api/auth/callback/github')
  }, [])
  return <code>{url}</code>
}

export default function Setup() {
  const cfg = useContext(ConfigCtx)
  if (cfg.isSetupComplete) redirect('/')

  const [configSaved, setConfigSaved] = useState(false)
  const [phase, setPhase] = useState<Phase>('config')
  const [configError, setConfigError] = useState('')
  const [seedError, setSeedError] = useState('')
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState({ pct: 0, label: '' })
  const [logs, setLogs] = useState<string[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  const streamHandlers = {
    onProgress(pct: number, label: string) {
      setProgress({ pct, label })
    },
    onLog(line: string) {
      setLogs(prev => [...prev, line])
    },
    onDone() {
      setProgress({ pct: 100, label: '' })
      setPhase('done')
    },
    onError(msg: string) {
      setSeedError(msg)
      setPhase('error')
    },
  }

  // Check status on mount (handles page reload during seeding)
  useEffect(() => {
    fetchSetupStatus().then(status => {
      if (status.configSaved) setConfigSaved(true)
      if (status.seeding) {
        setPhase('seeding')
        connectStream(streamHandlers)
      }
      if (status.seeded) setPhase('done')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-scroll log area
  useEffect(() => {
    const el = logRef.current
    if (el) {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20
      if (atBottom) el.scrollTop = el.scrollHeight
    }
  }, [logs])

  async function handleSaveConfig(formData: FormData) {
    setSaving(true)
    setConfigError('')
    const result = await saveSetupConfig(formData)
    setSaving(false)
    if ('error' in result) {
      setConfigError(result.error)
    } else {
      setConfigSaved(true)
    }
  }

  async function handleStartSeed() {
    setSeedError('')
    setPhase('seeding')
    setLogs([])
    setProgress({ pct: 0, label: 'Starting...' })
    const result = await startSeed()
    if ('error' in result) {
      setSeedError(result.error)
      setPhase('error')
      return
    }
    connectStream(streamHandlers)
  }

  return (
    <>
      <h1>Setup</h1>

      <h2>Step 1: GitHub Authentication</h2>
      <p style={{ color: '#607D8B', fontSize: '13px' }}>
        Create a{' '}
        <a href='https://github.com/settings/developers' target='_blank' rel='noreferrer'>
          GitHub OAuth App
        </a>{' '}
        and enter the credentials below. Set the &quot;Authorization callback URL&quot; to the value shown below:
      </p>
      <CallbackLink />
      {configSaved ? (
        <div className='setup-done-msg'>Authentication configured.</div>
      ) : (
        <>
          <form action={handleSaveConfig} className='setup-form'>
            <div className='setup-field'>
              <label htmlFor='clientId'>Client ID</label>
              <input type='text' id='clientId' name='clientId' placeholder='Ov23li...' required />
            </div>
            <div className='setup-field'>
              <label htmlFor='clientSecret'>Client Secret</label>
              <input type='password' id='clientSecret' name='clientSecret' placeholder='Enter client secret' required />
            </div>
            <button type='submit' className='primary' disabled={saving}>
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </form>
        </>
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
            <button className='primary' disabled={!configSaved} onClick={handleStartSeed}>
              {phase === 'error' ? 'Retry Setup' : 'Start Setup'}
            </button>
          )}

          {(phase === 'seeding' || phase === 'error') && progress.pct > 0 && (
            <div className='setup-progress'>
              <div className='setup-progress-outer'>
                <div className='setup-progress-inner' style={{ width: `${progress.pct}%` }} />
              </div>
              {phase === 'seeding' && (
                <div className='setup-progress-label'>
                  <span className='setup-spinner' />
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
