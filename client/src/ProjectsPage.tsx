import { useState, useEffect, useRef } from "react";
import {
  fetchProjects,
  createProject,
  updateProject,
  deleteProject,
} from "./api.ts";
import type { Project } from "./api.ts";

export function ProjectsPage({ username }: { username: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects()
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [username]);

  function handleCreated(project: Project) {
    setProjects((prev) => [...prev, project]);
  }

  function handleUpdated(id: string, name: string) {
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name } : p)),
    );
  }

  function handleDeleted(id: string) {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }

  if (loading) return <main style={{ maxWidth: 700 }}><p>Loading...</p></main>;
  if (error) return <main style={{ maxWidth: 700 }}><p>Error: {error}</p></main>;

  return (
    <main style={{ maxWidth: 700 }}>
      <h1>Projects</h1>
      <p>{username}'s workspaces</p>

      {projects.length === 0 ? (
        <p className="empty">No projects yet. Create one below.</p>
      ) : (
        <ul className="project-list">
          {projects.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              username={username}
              onUpdated={handleUpdated}
              onDeleted={handleDeleted}
            />
          ))}
        </ul>
      )}

      <NewProjectInline onCreated={handleCreated} />
    </main>
  );
}

function ProjectRow({
  project,
  username,
  onUpdated,
  onDeleted,
}: {
  project: Project;
  username: string;
  onUpdated: (id: string, name: string) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) nameRef.current?.focus();
  }, [editing]);

  async function handleSave() {
    const trimmed = editName.trim();
    if (!trimmed) {
      setEditError("Name is required");
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      await updateProject(project.id, trimmed);
      onUpdated(project.id, trimmed);
      setEditing(false);
    } catch (e: any) {
      setEditError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setEditName(project.name);
    setEditError(null);
    setEditing(false);
  }

  async function handleDelete() {
    if (!confirm(`Delete project "${project.name}"? Workspace files will be kept.`)) return;
    try {
      await deleteProject(project.id);
      onDeleted(project.id);
    } catch (e: any) {
      alert(e.message);
    }
  }

  if (editing) {
    return (
      <li>
        <div className="info" style={{ flex: 1 }}>
          <input
            ref={nameRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") handleCancel();
            }}
            placeholder="Project name"
            style={{ width: "100%", marginBottom: 4 }}
            disabled={saving}
          />
          {editError && <div style={{ color: "#dc2626", fontSize: 13 }}>{editError}</div>}
        </div>
        <div className="actions">
          <button onClick={handleSave} disabled={saving}>Save</button>
          <button onClick={handleCancel} disabled={saving}>Cancel</button>
        </div>
      </li>
    );
  }

  return (
    <li>
      <div className="info">
        <a href={`/${username}/${encodeURIComponent(project.name)}/`}>{project.name}</a>
      </div>
      <div className="actions">
        <button onClick={() => setEditing(true)}>Edit</button>
        <button className="delete" onClick={handleDelete}>Delete</button>
      </div>
    </li>
  );
}

function NewProjectInline({
  onCreated,
}: {
  onCreated: (project: Project) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) nameRef.current?.focus();
  }, [open]);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const project = await createProject(trimmed);
      onCreated(project);
      setName("");
      setOpen(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  function handleCancel() {
    setName("");
    setError(null);
    setOpen(false);
  }

  if (!open) {
    return (
      <div style={{ marginTop: 16 }}>
        <button
          onClick={() => setOpen(true)}
          style={{
            padding: "8px 20px",
            fontSize: 14,
            background: "#386EE0",
            color: "#fff",
            border: "none",
            borderRadius: "0.5rem",
            cursor: "pointer",
            fontWeight: 500,
            fontFamily: "inherit",
          }}
        >
          + New project
        </button>
      </div>
    );
  }

  return (
    <div className="new-project" style={{ marginTop: 16 }}>
      <input
        ref={nameRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleCreate();
          if (e.key === "Escape") handleCancel();
        }}
        placeholder="Project name (letters, digits, hyphens, underscores)"
        maxLength={100}
        disabled={creating}
      />
      {error && <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 8 }}>{error}</div>}
      <div>
        <button onClick={handleCreate} disabled={creating}>Create</button>
        <button
          onClick={handleCancel}
          disabled={creating}
          style={{
            marginLeft: 8,
            padding: "8px 20px",
            fontSize: 14,
            background: "#fff",
            color: "#333",
            border: "1px solid #D1D9E2",
            borderRadius: "0.5rem",
            cursor: "pointer",
            fontWeight: 500,
            fontFamily: "inherit",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
