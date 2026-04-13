<script lang="ts">
  interface Project {
    id: string
    name: string
    template: string
    isPublic: boolean
  }

  interface TemplateInfo {
    id: string
    name: string
    description: string
  }

  let { data } = $props<{
    data: { username: string; isOwner: boolean; projects: Project[]; templates: TemplateInfo[] }
  }>()

  let projects = $state<Project[]>([])
  let templates = $state<TemplateInfo[]>([])
  let username = $state('')
  let isOwner = $state(false)

  $effect(() => {
    projects = [...data.projects]
    templates = data.templates
    username = data.username
    isOwner = data.isOwner
  })

  // --- New project form ---
  let newOpen = $state(false)
  let newName = $state('')
  let newTemplate = $state('')
  let newCreating = $state(false)
  let newError = $state<string | null>(null)
  let newNameInput: HTMLInputElement | undefined = $state()

  $effect(() => {
    if (newOpen && newNameInput) newNameInput.focus()
  })

  function resetNewDefaults() {
    const defaultTemplate = templates.find(t => t.id !== 'blank')?.id ?? 'blank'
    newTemplate = defaultTemplate
  }

  async function handleCreate() {
    const trimmed = newName.trim()
    if (!trimmed) {
      newError = 'Name is required'
      return
    }
    newCreating = true
    newError = null
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, template: newTemplate }),
      })
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(e.error || 'Failed to create project')
      }
      const project = (await res.json()) as Project
      projects = [...projects, project]
      newName = ''
      resetNewDefaults()
      newOpen = false
    } catch (e: unknown) {
      newError = (e as Error).message
    } finally {
      newCreating = false
    }
  }

  function handleCancelNew() {
    newName = ''
    newError = null
    newOpen = false
  }

  // --- Editing ---
  let editingId = $state<string | null>(null)
  let editName = $state('')
  let editSaving = $state(false)
  let editError = $state<string | null>(null)
  let editInput: HTMLInputElement | undefined = $state()

  $effect(() => {
    if (editingId && editInput) editInput.focus()
  })

  function startEdit(project: Project) {
    editingId = project.id
    editName = project.name
    editError = null
  }

  async function handleSaveEdit(project: Project) {
    const trimmed = editName.trim()
    if (!trimmed) {
      editError = 'Name is required'
      return
    }
    editSaving = true
    editError = null
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(e.error || 'Failed to update project')
      }
      projects = projects.map(p => (p.id === project.id ? { ...p, name: trimmed } : p))
      editingId = null
    } catch (e: unknown) {
      editError = (e as Error).message
    } finally {
      editSaving = false
    }
  }

  function cancelEdit() {
    editingId = null
    editError = null
  }

  async function handleDelete(project: Project) {
    if (!confirm(`Delete project "${project.name}"? Workspace files will be kept.`)) return
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(e.error || 'Failed to delete project')
      }
      projects = projects.filter(p => p.id !== project.id)
    } catch (e: unknown) {
      alert((e as Error).message)
    }
  }

  async function handleToggleVisibility(project: Project) {
    const newPublic = !project.isPublic
    try {
      const res = await fetch(`/api/projects/${project.id}/visibility`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public: newPublic }),
      })
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(e.error || 'Failed to update visibility')
      }
      projects = projects.map(p => (p.id === project.id ? { ...p, isPublic: newPublic } : p))
    } catch (e: unknown) {
      alert((e as Error).message)
    }
  }
</script>

<svelte:head>
  <title>{username} - Profile - Lean Workbench</title>
</svelte:head>

<main style="max-width: 700px;">
  <h1>Projects</h1>
  <p>{username}'s workspaces</p>

  {#if projects.length === 0}
    <p class="empty">{isOwner ? 'No projects yet. Create one below.' : 'No public projects.'}</p>
  {:else}
    <ul class="project-list">
      {#each projects as project (project.id)}
        {#if isOwner && editingId === project.id}
          <li>
            <div class="info" style="flex: 1;">
              <input
                bind:this={editInput}
                bind:value={editName}
                onkeydown={e => {
                  if (e.key === 'Enter') void handleSaveEdit(project)
                  if (e.key === 'Escape') cancelEdit()
                }}
                placeholder="Project name"
                style="width: 100%; margin-bottom: 4px;"
                disabled={editSaving}
              />
              {#if editError}
                <div style="color: #dc2626; font-size: 13px;">{editError}</div>
              {/if}
            </div>
            <div class="actions">
              <button onclick={() => handleSaveEdit(project)} disabled={editSaving}>Save</button>
              <button onclick={cancelEdit} disabled={editSaving}>Cancel</button>
            </div>
          </li>
        {:else if isOwner}
          <li>
            <div class="info">
              <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- [username]/[projectName] route not yet created -->
              <a href="/{username}/{encodeURIComponent(project.name)}/">{project.name}</a>
            </div>
            <div class="actions">
              <button onclick={() => handleToggleVisibility(project)}>{project.isPublic ? 'Public' : 'Private'}</button>
              <button onclick={() => startEdit(project)}>Edit</button>
              <button class="delete" onclick={() => handleDelete(project)}>Delete</button>
            </div>
          </li>
        {:else}
          <li>
            <div class="info">
              <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
              <a href="/{username}/{encodeURIComponent(project.name)}/">{project.name}</a>
            </div>
          </li>
        {/if}
      {/each}
    </ul>
  {/if}

  {#if isOwner}
    {#if !newOpen}
      <div style="margin-top: 16px;">
        <button
          class="primary"
          onclick={() => {
            resetNewDefaults()
            newOpen = true
          }}>+ New project</button
        >
      </div>
    {:else}
      <div class="new-project" style="margin-top: 16px;">
        <input
          bind:this={newNameInput}
          type="text"
          bind:value={newName}
          onkeydown={e => {
            if (e.key === 'Enter') void handleCreate()
            if (e.key === 'Escape') handleCancelNew()
          }}
          placeholder="Project name (letters, digits, hyphens, underscores)"
          maxlength={100}
          disabled={newCreating}
        />
        <div class="template-selector">
          {#each templates as t (t.id)}
            <button
              type="button"
              class="template-option {newTemplate === t.id ? 'selected' : ''}"
              onclick={() => (newTemplate = t.id)}
              disabled={newCreating}
            >
              <strong>{t.name}</strong>
              <span>{t.description}</span>
            </button>
          {/each}
        </div>
        {#if newError}
          <div style="color: #dc2626; font-size: 13px; margin-bottom: 8px;">{newError}</div>
        {/if}
        <div>
          <button class="primary" onclick={handleCreate} disabled={newCreating}>Create</button>
          <button onclick={handleCancelNew} disabled={newCreating} style="margin-left: 8px;">Cancel</button>
        </div>
      </div>
    {/if}
  {/if}
</main>
