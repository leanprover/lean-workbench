<script lang="ts">
  import { resolve } from '$app/paths'

  interface SetupStatus {
    githubConfigSaved: boolean
    seeded: boolean
    seeding: boolean
  }

  let githubConfigSaved = $state(false)
  let seeding = $state(false)
  let seeded = $state(false)
  let configError = $state('')
  let seedError = $state('')
  let savingConfig = $state(false)

  let clientId = $state('')
  let clientSecret = $state('')

  // Progress state
  let showProgress = $state(false)
  let showLog = $state(false)
  let progressPercent = $state(0)
  let progressText = $state('Starting...')
  let logLines = $state<string[]>([])
  let logArea: HTMLDivElement | undefined = $state()

  // Check initial status on mount
  $effect(() => {
    fetch('/api/setup/status')
      .then(r => r.json() as Promise<SetupStatus>)
      .then(data => {
        githubConfigSaved = data.githubConfigSaved
        seeded = data.seeded
        if (data.seeding) {
          seeding = true
          showProgress = true
          showLog = true
          streamLogs()
        }
      })
      .catch(() => {})
  })

  function saveConfig() {
    if (!clientId.trim() || !clientSecret.trim()) {
      configError = 'Client ID and Client Secret are required.'
      return
    }
    savingConfig = true
    configError = ''

    fetch('/api/setup/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        githubClientId: clientId.trim(),
        githubClientSecret: clientSecret.trim(),
      }),
    })
      .then(r => {
        if (!r.ok) throw new Error('Failed to save configuration')
        githubConfigSaved = true
      })
      .catch((err: Error) => {
        configError = err.message
      })
      .finally(() => {
        savingConfig = false
      })
  }

  function startSetup() {
    seeding = true
    showProgress = true
    showLog = true
    seedError = ''

    fetch('/api/setup/seed', { method: 'POST' })
      .then(r => {
        if (!r.ok) throw new Error('Failed to start setup')
        streamLogs()
      })
      .catch((err: Error) => showSeedError(err.message))
  }

  function streamLogs() {
    const source = new EventSource('/api/setup/stream')

    source.onmessage = event => {
      const data = JSON.parse(event.data as string) as {
        type: string
        step?: number
        total?: number
        label?: string
        line?: string
        message?: string
      }
      if (data.type === 'progress') {
        progressPercent = Math.round(((data.step ?? 0) / (data.total ?? 1)) * 100)
        progressText = `${data.label} (${data.step}/${data.total})`
      } else if (data.type === 'log') {
        logLines = [...logLines, data.line ?? '']
        // Auto-scroll
        requestAnimationFrame(() => {
          if (logArea) {
            const atBottom = logArea.scrollHeight - logArea.scrollTop - logArea.clientHeight < 20
            if (atBottom) logArea.scrollTop = logArea.scrollHeight
          }
        })
      } else if (data.type === 'done') {
        source.close()
        progressPercent = 100
        seeded = true
        seeding = false
      } else if (data.type === 'error') {
        source.close()
        showSeedError(data.message ?? 'Unknown error')
      }
    }

    source.onerror = () => {
      source.close()
      fetch('/api/setup/status')
        .then(r => r.json() as Promise<SetupStatus>)
        .then(data => {
          if (data.seeded) {
            seeded = true
            seeding = false
          } else if (!data.seeding) {
            showSeedError('Connection lost')
          }
        })
        .catch(() => {})
    }
  }

  function showSeedError(msg: string) {
    seedError = msg
    seeding = false
    showProgress = false
  }
</script>

<svelte:head>
  <title>Lean Workbench Setup</title>
</svelte:head>

<main style="max-width: 600px;">
  <h1>Setup</h1>

  <h2>Step 1: GitHub Authentication</h2>
  <p style="color: #607D8B; font-size: 13px;">
    Create a
    <a href="https://github.com/settings/developers" target="_blank">GitHub OAuth App</a>
    and enter the credentials below.
  </p>

  {#if !githubConfigSaved}
    <div class="form-field">
      <label for="client-id">Client ID</label>
      <input id="client-id" type="text" bind:value={clientId} placeholder="Ov23li..." disabled={savingConfig} />
    </div>
    <div class="form-field">
      <label for="client-secret">Client Secret</label>
      <input
        id="client-secret"
        type="password"
        bind:value={clientSecret}
        placeholder="Enter client secret"
        disabled={savingConfig}
      />
    </div>
    {#if configError}
      <div class="setup-error">{configError}</div>
    {/if}
    <button class="primary" onclick={saveConfig} disabled={savingConfig}>
      {savingConfig ? 'Saving...' : 'Save Configuration'}
    </button>
  {:else}
    <div class="setup-success">Authentication configured.</div>
  {/if}

  <hr class="section-divider" />

  <h2>Step 2: Initialize Data Volume</h2>
  <p style="color: #607D8B; font-size: 13px;">
    Install elan, download pre-compiled Mathlib, and set up project templates. This may take several minutes.
  </p>

  {#if seeded}
    <div class="setup-success">
      Setup complete! <a href={resolve('/')}>Continue to Lean Workbench</a>
    </div>
  {:else}
    <button class="primary" onclick={startSetup} disabled={!githubConfigSaved || seeding}>
      {#if seeding}
        Setting up...
      {:else if seedError}
        Retry Setup
      {:else}
        Start Setup
      {/if}
    </button>

    {#if showProgress}
      <div class="progress-area">
        <div class="progress-bar-outer">
          <div class="progress-bar-inner" style="width: {progressPercent}%;"></div>
        </div>
        <div class="progress-label">
          <span class="spinner"></span>
          <span>{progressText}</span>
        </div>
      </div>
    {/if}

    {#if showLog && logLines.length > 0}
      <div class="log-area" bind:this={logArea}>
        {#each logLines as line, i (i)}
          {line + '\n'}
        {/each}
      </div>
    {/if}

    {#if seedError}
      <div class="setup-error">Setup failed: {seedError}</div>
    {/if}
  {/if}
</main>

<style>
  .form-field {
    margin-bottom: 12px;
  }
  .form-field label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .form-field input {
    width: 100%;
    padding: 8px 10px;
    font-size: 14px;
    border: 1px solid #d1d9e2;
    border-radius: 0.5rem;
    font-family: inherit;
    box-sizing: border-box;
  }
  .form-field input:disabled {
    background: #f5f5f5;
    color: #999;
  }
  .section-divider {
    border: none;
    border-top: 1px solid #e4ebf3;
    margin: 24px 0;
  }
  .progress-area {
    margin: 20px 0;
  }
  .progress-bar-outer {
    width: 100%;
    height: 8px;
    background: #e4ebf3;
    border-radius: 4px;
    overflow: hidden;
  }
  .progress-bar-inner {
    height: 100%;
    width: 0%;
    background: #386ee0;
    border-radius: 4px;
    transition: width 0.4s ease;
  }
  .progress-label {
    margin-top: 8px;
    font-size: 13px;
    color: #607d8b;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid #d1d9e2;
    border-top-color: #386ee0;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .log-area {
    margin: 12px 0;
    padding: 12px;
    background: #1a1a2e;
    color: #a0d0a0;
    border-radius: 0.5rem;
    font-family: 'Courier New', monospace;
    font-size: 12px;
    line-height: 1.5;
    max-height: 300px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .setup-success {
    margin: 20px 0;
    padding: 12px 16px;
    background: #f0fdf4;
    border: 1px solid #86efac;
    border-radius: 0.5rem;
    color: #166534;
    font-weight: 500;
  }
  .setup-success a {
    color: #386ee0;
    text-decoration: none;
    font-weight: 600;
  }
  .setup-success a:hover {
    text-decoration: underline;
  }
  .setup-error {
    margin: 12px 0;
    padding: 12px 16px;
    background: #fef2f2;
    border: 1px solid #fca5a5;
    border-radius: 0.5rem;
    color: #dc2626;
    font-weight: 500;
  }
</style>
