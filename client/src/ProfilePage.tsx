import { useEffect, useRef, useState } from 'react'
import type { Project, TemplateInfo } from './api'
import {
  createProject,
  deleteProject,
  fetchProjects,
  fetchTemplates,
  fetchUserProjects,
  setProjectVisibility,
  updateProject,
} from './api'

export function ProfilePage({ username, isAdmin, isOwner }: { username: string; isAdmin: boolean; isOwner: boolean }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const projectsPromise = isOwner ? fetchProjects() : fetchUserProjects(username)
    const templatesPromise = isOwner ? fetchTemplates() : Promise.resolve([])
    Promise.all([projectsPromise, templatesPromise])
      .then(([projects, templates]) => {
        setProjects(projects)
        setTemplates(templates)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [username, isAdmin, isOwner])

  function handleCreated(project: Project) {
    setProjects(prev => [...prev, project])
  }

  function handleUpdated(id: string, name: string) {
    setProjects(prev => prev.map(p => (p.id === id ? { ...p, name } : p)))
  }

  function handleDeleted(id: string) {
    setProjects(prev => prev.filter(p => p.id !== id))
  }

  function handleVisibilityChanged(id: string, isPublic: boolean) {
    setProjects(prev => prev.map(p => (p.id === id ? { ...p, public: isPublic ? 1 : 0 } : p)))
  }

  if (loading)
    return (
      <main style={{ maxWidth: 700 }}>
        <p>Loading...</p>
      </main>
    )
  if (error)
    return (
      <main style={{ maxWidth: 700 }}>
        <p>Error: {error}</p>
      </main>
    )

  return (
    <main style={{ maxWidth: 700 }}>
      <h1>Projects</h1>
      <p>{username}'s workspaces</p>

      {projects.length === 0 ? (
        <p className="empty">{isOwner ? 'No projects yet. Create one below.' : 'No public projects.'}</p>
      ) : (
        <ul className="project-list">
          {projects.map(p =>
            isOwner ? (
              <ProjectRow
                key={p.id}
                project={p}
                username={username}
                onUpdated={handleUpdated}
                onDeleted={handleDeleted}
                onVisibilityChanged={handleVisibilityChanged}
              />
            ) : (
              <li key={p.id}>
                <div className="info">
                  <a href={`/${username}/${encodeURIComponent(p.name)}/`}>{p.name}</a>
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      {isOwner && <NewProjectInline onCreated={handleCreated} templates={templates} />}
    </main>
  )
}

function ProjectRow({
  project,
  username,
  onUpdated,
  onDeleted,
  onVisibilityChanged,
}: {
  project: Project
  username: string
  onUpdated: (id: string, name: string) => void
  onDeleted: (id: string) => void
  onVisibilityChanged: (id: string, isPublic: boolean) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(project.name)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) nameRef.current?.focus()
  }, [editing])

  async function handleSave() {
    const trimmed = editName.trim()
    if (!trimmed) {
      setEditError('Name is required')
      return
    }
    setSaving(true)
    setEditError(null)
    try {
      await updateProject(project.id, trimmed)
      onUpdated(project.id, trimmed)
      setEditing(false)
    } catch (e: any) {
      setEditError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function handleCancel() {
    setEditName(project.name)
    setEditError(null)
    setEditing(false)
  }

  async function handleDelete() {
    if (!confirm(`Delete project "${project.name}"? Workspace files will be kept.`)) return
    try {
      await deleteProject(project.id)
      onDeleted(project.id)
    } catch (e: any) {
      alert(e.message)
    }
  }

  async function handleToggleVisibility() {
    const newPublic = !project.public
    try {
      await setProjectVisibility(project.id, newPublic)
      onVisibilityChanged(project.id, newPublic)
    } catch (e: any) {
      alert(e.message)
    }
  }

  if (editing) {
    return (
      <li>
        <div className="info" style={{ flex: 1 }}>
          <input
            ref={nameRef}
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void handleSave()
              if (e.key === 'Escape') handleCancel()
            }}
            placeholder="Project name"
            style={{ width: '100%', marginBottom: 4 }}
            disabled={saving}
          />
          {editError && <div style={{ color: '#dc2626', fontSize: 13 }}>{editError}</div>}
        </div>
        <div className="actions">
          <button onClick={() => void handleSave()} disabled={saving}>
            Save
          </button>
          <button onClick={handleCancel} disabled={saving}>
            Cancel
          </button>
        </div>
      </li>
    )
  }

  return (
    <li>
      <div className="info">
        <a href={`/${username}/${encodeURIComponent(project.name)}/`}>{project.name}</a>
      </div>
      <div className="actions">
        <button onClick={() => void handleToggleVisibility()}>{project.public ? 'Public' : 'Private'}</button>
        <button onClick={() => setEditing(true)}>Edit</button>
        <button className="delete" onClick={() => void handleDelete()}>
          Delete
        </button>
      </div>
    </li>
  )
}

function NewProjectInline({
  onCreated,
  templates,
}: {
  onCreated: (project: Project) => void
  templates: TemplateInfo[]
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const defaultTemplate = templates.find(t => t.id !== 'blank')?.id ?? 'blank'
  const [template, setTemplate] = useState<string>(defaultTemplate)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) nameRef.current?.focus()
  }, [open])

  async function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name is required')
      return
    }
    setCreating(true)
    setError(null)
    try {
      const project = await createProject(trimmed, template)
      onCreated(project)
      setName('')
      setTemplate(defaultTemplate)
      setOpen(false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }

  function handleCancel() {
    setName('')
    setError(null)
    setOpen(false)
  }

  if (!open) {
    return (
      <div style={{ marginTop: 16 }}>
        <button
          onClick={() => setOpen(true)}
          style={{
            padding: '8px 20px',
            fontSize: 14,
            background: '#386EE0',
            color: '#fff',
            border: 'none',
            borderRadius: '0.5rem',
            cursor: 'pointer',
            fontWeight: 500,
            fontFamily: 'inherit',
          }}
        >
          + New project
        </button>
      </div>
    )
  }

  return (
    <div className="new-project" style={{ marginTop: 16 }}>
      <input
        ref={nameRef}
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') void handleCreate()
          if (e.key === 'Escape') handleCancel()
        }}
        placeholder="Project name (letters, digits, hyphens, underscores)"
        maxLength={100}
        disabled={creating}
      />
      <div className="template-selector">
        {templates.map(t => (
          <button
            key={t.id}
            type="button"
            className={`template-option${template === t.id ? ' selected' : ''}`}
            onClick={() => setTemplate(t.id)}
            disabled={creating}
          >
            <strong>{t.name}</strong>
            <span>{t.description}</span>
          </button>
        ))}
      </div>
      {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 8 }}>{error}</div>}
      <div>
        <button onClick={() => void handleCreate()} disabled={creating}>
          Create
        </button>
        <button
          onClick={handleCancel}
          disabled={creating}
          style={{
            marginLeft: 8,
            padding: '8px 20px',
            fontSize: 14,
            background: '#fff',
            color: '#333',
            border: '1px solid #D1D9E2',
            borderRadius: '0.5rem',
            cursor: 'pointer',
            fontWeight: 500,
            fontFamily: 'inherit',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
