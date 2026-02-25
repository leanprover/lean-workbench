export interface Project {
  id: string;
  name: string;
}

export interface SessionStatus {
  port: number;
  pid: number;
  alive: boolean;
  workspace: string;
  projectId: string;
}

export async function fetchStatus(): Promise<Record<string, SessionStatus>> {
  const res = await fetch("/api/status");
  if (!res.ok) throw new Error("Failed to fetch status");
  const data = await res.json();
  return data.sessions;
}

const API_BASE = "/api/projects";

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(API_BASE);
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json();
}

export async function createProject(name: string): Promise<Project> {
  const res = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || "Failed to create project");
  }
  return res.json();
}

export async function updateProject(
  projectId: string,
  name: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/${projectId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || "Failed to update project");
  }
}

export async function deleteProject(projectId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/${projectId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || "Failed to delete project");
  }
}
