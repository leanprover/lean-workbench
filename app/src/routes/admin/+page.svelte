<script lang="ts">
  interface EditorSessionStatus {
    port: number
    pid: number
    workspaceDir: string
    projectId: string
    alive: boolean
  }

  interface HealthInfo {
    activeEditorSessions: number
    dataVolumeDisk: { total: string; used: string; available: string; percent: string }
    uptime: number
    memory: { total: number; available: number; swapTotal: number; swapFree: number }
    loadAvg: number[]
  }

  interface AdminUser {
    id: string
    name: string
    isAdmin: boolean
    createdAt: string
  }

  let { data } = $props<{ data: { adminUsername: string } }>()

  // --- State ---
  let loading = $state(true)
  let error = $state<string | null>(null)

  let sessions = $state<Record<string, EditorSessionStatus>>({})
  let registrationMode = $state('open')
  let savedMode = $state('open')
  let allowedUsers = $state<string[]>([])
  let users = $state<AdminUser[]>([])
  let oauthClientId = $state('')
  let oauthEditing = $state(false)
  let oauthForm = $state({ clientId: '', clientSecret: '' })
  let oauthSaving = $state(false)
  let expandedUserId = $state<string | null>(null)
  let newUser = $state('')
  let newUserInput: HTMLInputElement | undefined = $state()
  let health = $state<HealthInfo | null>(null)
  let workspacesSize = $state<string | null>(null)
  let duLoading = $state(false)
  let saving = $state(false)

  // --- Confirm dialog ---
  let confirmAction = $state<{
    title: string
    message: string
    confirmLabel: string
    danger?: boolean
    onConfirm: () => Promise<void>
  } | null>(null)
  let confirmBusy = $state(false)
  let confirmDialog: HTMLDialogElement | undefined = $state()

  $effect(() => {
    if (confirmAction && confirmDialog) confirmDialog.showModal()
  })

  async function handleConfirm() {
    if (!confirmAction) return
    confirmBusy = true
    try {
      await confirmAction.onConfirm()
      confirmDialog?.close()
      confirmAction = null
    } finally {
      confirmBusy = false
    }
  }

  function closeConfirm() {
    confirmAction = null
  }

  // --- Data loading ---
  $effect(() => {
    Promise.all([
      fetch('/api/admin/status').then(
        r => r.json() as Promise<{ editorSessions: Record<string, EditorSessionStatus> }>,
      ),
      fetch('/api/admin/settings').then(r => r.json() as Promise<{ registrationMode: string }>),
      fetch('/api/admin/allowed-users').then(r => r.json() as Promise<string[]>),
      fetch('/api/admin/users').then(r => r.json() as Promise<AdminUser[]>),
      fetch('/api/admin/auth/github').then(r => r.json() as Promise<{ clientId: string }>),
      fetch('/api/admin/health').then(r => r.json() as Promise<HealthInfo>),
    ])
      .then(([statusData, settings, allowed, userList, oauth, healthData]) => {
        sessions = statusData.editorSessions
        registrationMode = settings.registrationMode
        savedMode = settings.registrationMode
        allowedUsers = allowed
        users = userList
        oauthClientId = oauth.clientId
        health = healthData
      })
      .catch((e: Error) => (error = e.message))
      .finally(() => (loading = false))
  })

  // Health refresh interval
  $effect(() => {
    const interval = setInterval(() => {
      fetch('/api/admin/health')
        .then(r => r.json() as Promise<HealthInfo>)
        .then(h => (health = h))
        .catch(() => {})
    }, 30_000)
    return () => clearInterval(interval)
  })

  // --- Helpers ---
  function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400)
    const h = Math.floor((seconds % 86400) / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const parts: string[] = []
    if (d > 0) parts.push(`${d}d`)
    if (h > 0) parts.push(`${h}h`)
    parts.push(`${m}m`)
    return parts.join(' ')
  }

  function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB'
    return (bytes / 1024 / 1024).toFixed(0) + ' MB'
  }

  let alive = $derived(Object.entries(sessions).filter(([, s]) => s.alive))
  let modeChanged = $derived(registrationMode !== savedMode)

  // --- Handlers ---
  async function handleSaveMode() {
    saving = true
    error = null
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationMode }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || 'Failed')
      }
      savedMode = registrationMode
    } catch (e: unknown) {
      error = (e as Error).message
    } finally {
      saving = false
    }
  }

  async function handleKillSession(key: string) {
    const [viewer, projectId] = key.split('/')
    error = null
    try {
      const res = await fetch(`/api/admin/editor-sessions/${viewer}/${projectId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to kill session')
      const next = { ...sessions }
      delete next[key]
      sessions = next
    } catch (e: unknown) {
      error = (e as Error).message
    }
  }

  async function handleAddUser() {
    const trimmed = newUser.trim().toLowerCase()
    if (!trimmed) return
    error = null
    try {
      const res = await fetch('/api/admin/allowed-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: trimmed }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || 'Failed')
      }
      if (!allowedUsers.includes(trimmed)) {
        allowedUsers = [...allowedUsers, trimmed].sort()
      }
      newUser = ''
      newUserInput?.focus()
    } catch (e: unknown) {
      error = (e as Error).message
    }
  }

  async function handleRemoveUser(u: string) {
    error = null
    try {
      const res = await fetch(`/api/admin/allowed-users/${encodeURIComponent(u)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to remove user')
      allowedUsers = allowedUsers.filter(x => x !== u)
    } catch (e: unknown) {
      error = (e as Error).message
    }
  }

  function confirmToggleAdmin(u: AdminUser) {
    const newValue = !u.isAdmin
    confirmAction = {
      title: newValue ? 'Promote to admin' : 'Remove admin',
      message: newValue
        ? `Make ${u.name} an administrator? They will be able to manage all users and settings.`
        : `Remove admin privileges from ${u.name}?`,
      confirmLabel: newValue ? 'Make admin' : 'Remove admin',
      async onConfirm() {
        const res = await fetch(`/api/admin/users/${u.id}/admin`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ admin: newValue }),
        })
        if (!res.ok) throw new Error('Failed')
        users = users.map(x => (x.id === u.id ? { ...x, isAdmin: newValue } : x))
      },
    }
  }

  function confirmDeleteUser(u: AdminUser) {
    confirmAction = {
      title: 'Delete user',
      message: `Permanently delete ${u.name} and all their projects? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
      async onConfirm() {
        const res = await fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('Failed')
        users = users.filter(x => x.id !== u.id)
        expandedUserId = null
      },
    }
  }

  function handleOauthEdit() {
    oauthForm = { clientId: oauthClientId, clientSecret: '' }
    oauthEditing = true
  }

  async function handleOauthSave() {
    oauthSaving = true
    error = null
    try {
      const res = await fetch('/api/admin/auth/github', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: oauthForm.clientId,
          clientSecret: oauthForm.clientSecret || undefined,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || 'Failed')
      }
      oauthClientId = oauthForm.clientId
      oauthEditing = false
    } catch (e: unknown) {
      error = (e as Error).message
    } finally {
      oauthSaving = false
    }
  }

  async function handleComputeDiskUsage() {
    duLoading = true
    try {
      const res = await fetch('/api/admin/disk-usage')
      const d = (await res.json()) as { workspaces: string }
      workspacesSize = d.workspaces
    } catch {
      workspacesSize = 'error'
    }
    duLoading = false
  }
</script>

<svelte:head>
  <title>Admin - Lean Workbench</title>
</svelte:head>

<main class="admin-page">
  <h1>Admin</h1>

  {#if loading}
    <p>Loading...</p>
  {:else}
    {#if error}
      <div style="color: #dc2626; margin-bottom: 16px;">{error}</div>
    {/if}

    <section>
      <h2>Active editor sessions</h2>
      {#if alive.length === 0}
        <p class="empty">No active editor sessions.</p>
      {:else}
        <ul class="project-list">
          {#each alive as [key, s] (key)}
            {@const user = key.split('/')[0]}
            <li>
              <div class="info">
                <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
                <a href="/{user}/">{user}</a>
                <span style="color: #90a4ae; margin: 0 0.25rem;">/</span>
                <span style="font-size: 0.85rem; color: #666;">{s.projectId.slice(0, 8)}</span>
              </div>
              <div class="actions">
                <span style="font-size: 0.8rem; color: #90a4ae;">port {s.port}</span>
                <button class="delete" onclick={() => void handleKillSession(key)}>Kill</button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section>
      <h2>OAuth Configuration</h2>
      {#if oauthEditing}
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <label>
            Client ID
            <input type="text" bind:value={oauthForm.clientId} style="width: 100%; margin-top: 4px;" />
          </label>
          <label>
            Client Secret
            <input
              type="password"
              bind:value={oauthForm.clientSecret}
              placeholder="Leave empty to keep current"
              style="width: 100%; margin-top: 4px;"
            />
          </label>
          <div style="display: flex; gap: 8px; margin-top: 4px;">
            <button onclick={() => void handleOauthSave()} disabled={oauthSaving}>
              {oauthSaving ? 'Saving...' : 'Save'}
            </button>
            <button onclick={() => (oauthEditing = false)}>Cancel</button>
          </div>
        </div>
      {:else}
        <div>
          <p style="font-size: 0.9rem; margin: 4px 0;">
            <strong>Client ID:</strong>
            {oauthClientId || 'not configured'}
          </p>
          <button onclick={handleOauthEdit} style="margin-top: 8px;">Edit</button>
        </div>
      {/if}
    </section>

    <section>
      <h2>Access control</h2>
      <div style="display: flex; gap: 16px; margin-bottom: 12px;">
        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
          <input type="radio" name="regMode" value="open" bind:group={registrationMode} />
          Open registration
        </label>
        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
          <input type="radio" name="regMode" value="restricted" bind:group={registrationMode} />
          Restricted (allowlist only)
        </label>
      </div>
      {#if modeChanged}
        <button onclick={() => void handleSaveMode()} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      {/if}
    </section>

    <section>
      <h2>Allowed users</h2>
      <p style="font-size: 0.9rem; color: #666; margin-bottom: 12px;">
        GitHub usernames allowed to register when mode is "restricted".
      </p>
      {#if allowedUsers.length === 0}
        <p class="empty">No users in the allowlist.</p>
      {:else}
        <ul class="project-list">
          {#each allowedUsers as u (u)}
            <li>
              <div class="info">{u}</div>
              <div class="actions">
                <button class="delete" onclick={() => void handleRemoveUser(u)}>Remove</button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
      <div style="display: flex; gap: 8px; margin-top: 12px;">
        <input
          bind:this={newUserInput}
          type="text"
          bind:value={newUser}
          onkeydown={e => {
            if (e.key === 'Enter') void handleAddUser()
          }}
          placeholder="GitHub username"
          style="flex: 1;"
        />
        <button onclick={() => void handleAddUser()}>Add</button>
      </div>
    </section>

    <section>
      <h2>Registered users</h2>
      {#if users.length === 0}
        <p class="empty">No users.</p>
      {:else}
        <ul class="project-list">
          {#each users as u (u.id)}
            {@const isExpanded = expandedUserId === u.id}
            {@const isSelf = u.name === data.adminUsername}
            <li style="display: block;">
              <div
                style="display: flex; align-items: center; cursor: pointer;"
                role="button"
                tabindex="0"
                onclick={() => (expandedUserId = isExpanded ? null : u.id)}
                onkeydown={e => {
                  if (e.key === 'Enter' || e.key === ' ') expandedUserId = isExpanded ? null : u.id
                }}
              >
                <span style="width: 16px; font-size: 0.7rem; color: #90a4ae;">
                  {isExpanded ? '\u25BC' : '\u25B6'}
                </span>
                <div class="info" style="flex: 1;">
                  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
                  <a href="/{u.name}/" onclick={e => e.stopPropagation()} onkeydown={e => e.stopPropagation()}
                    >{u.name}</a
                  >
                  {#if isSelf}
                    <span style="font-size: 0.75rem; color: #90a4ae; margin-left: 8px;">(you)</span>
                  {/if}
                </div>
                <span style="font-size: 0.8rem; color: #90a4ae;">{u.isAdmin ? 'admin' : 'user'}</span>
              </div>
              {#if isExpanded}
                <div style="padding: 12px 0 4px 16px; display: flex; gap: 8px;">
                  <button disabled={isSelf} onclick={() => confirmToggleAdmin(u)}>
                    {u.isAdmin ? 'Make normal user' : 'Make admin'}
                  </button>
                  <button class="delete" disabled={isSelf} onclick={() => confirmDeleteUser(u)}>Delete user</button>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if health}
      <section>
        <h2>System health</h2>
        <table style="border-collapse: collapse; width: 100%;">
          <tbody>
            <tr>
              <td style="padding: 4px 12px 4px 0; color: #666;">Host Disk usage</td>
              <td style="padding: 4px 0;">
                {health.dataVolumeDisk.used} / {health.dataVolumeDisk.total} ({health.dataVolumeDisk.percent})
              </td>
            </tr>
            <tr>
              <td style="padding: 4px 12px 4px 0; color: #666;">Host Memory</td>
              <td style="padding: 4px 0;">
                {formatBytes(health.memory.total - health.memory.available)} / {formatBytes(health.memory.total)} used
              </td>
            </tr>
            {#if health.memory.swapTotal > 0}
              <tr>
                <td style="padding: 4px 12px 4px 0; color: #666;">Swap</td>
                <td style="padding: 4px 0;">
                  {formatBytes(health.memory.swapTotal - health.memory.swapFree)} / {formatBytes(
                    health.memory.swapTotal,
                  )}
                  used
                </td>
              </tr>
            {/if}
            <tr>
              <td style="padding: 4px 12px 4px 0; color: #666;">Workspaces size</td>
              <td style="padding: 4px 0;">
                {#if workspacesSize}
                  {workspacesSize}
                {:else}
                  <button disabled={duLoading} onclick={() => void handleComputeDiskUsage()}>
                    {duLoading ? 'Computing...' : 'Compute'}
                  </button>
                {/if}
              </td>
            </tr>
            <tr>
              <td style="padding: 4px 12px 4px 0; color: #666;">Load average</td>
              <td style="padding: 4px 0;">{health.loadAvg.map(n => n.toFixed(2)).join(', ')}</td>
            </tr>
            <tr>
              <td style="padding: 4px 12px 4px 0; color: #666;">Workbench uptime</td>
              <td style="padding: 4px 0;">{formatUptime(health.uptime)}</td>
            </tr>
          </tbody>
        </table>
      </section>
    {/if}
  {/if}
</main>

{#if confirmAction}
  <dialog bind:this={confirmDialog} onclose={closeConfirm}>
    <h3 style="margin: 0 0 8px;">{confirmAction.title}</h3>
    <p style="margin: 0 0 20px; color: #555;">{confirmAction.message}</p>
    <div style="display: flex; gap: 8px; justify-content: flex-end;">
      <button onclick={closeConfirm} disabled={confirmBusy}>Cancel</button>
      <button
        class={confirmAction.danger ? 'delete' : 'primary'}
        onclick={() => void handleConfirm()}
        disabled={confirmBusy}
      >
        {confirmBusy ? '...' : confirmAction.confirmLabel}
      </button>
    </div>
  </dialog>
{/if}
