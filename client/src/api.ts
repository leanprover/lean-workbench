export interface Project {
  id: string;
  name: string;
  template: string;
  public: number;
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
}

export async function fetchTemplates(): Promise<TemplateInfo[]> {
  const res = await fetch("/api/templates");
  if (!res.ok) throw new Error("Failed to fetch templates");
  return res.json();
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

export async function createProject(name: string, template: string = 'blank'): Promise<Project> {
  const res = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, template }),
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

export async function fetchUserProjects(username: string): Promise<Project[]> {
  const res = await fetch(`/api/users/${encodeURIComponent(username)}/projects`);
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json();
}

export async function setProjectVisibility(projectId: string, isPublic: boolean): Promise<void> {
  const res = await fetch(`${API_BASE}/${projectId}/visibility`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ public: isPublic }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || "Failed to update visibility");
  }
}

// --- Admin API ---

export async function fetchAdminSettings(): Promise<{ registrationMode: string }> {
  const res = await fetch("/api/admin/settings");
  if (!res.ok) throw new Error("Failed to fetch admin settings");
  return res.json();
}

export async function updateAdminSettings(settings: { registrationMode: string }): Promise<void> {
  const res = await fetch("/api/admin/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || "Failed to update settings");
  }
}

export async function fetchAllowedUsers(): Promise<string[]> {
  const res = await fetch("/api/admin/allowed-users");
  if (!res.ok) throw new Error("Failed to fetch allowed users");
  return res.json();
}

export async function addAllowedUser(username: string): Promise<void> {
  const res = await fetch("/api/admin/allowed-users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || "Failed to add user");
  }
}

export async function removeAllowedUser(username: string): Promise<void> {
  const res = await fetch(`/api/admin/allowed-users/${encodeURIComponent(username)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || "Failed to remove user");
  }
}

// --- Admin users API ---

export interface AdminUser {
  id: number;
  username: string;
  is_admin: boolean;
  created_at: string;
}

export async function fetchUsers(): Promise<AdminUser[]> {
  const res = await fetch("/api/admin/users");
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
}

export async function deleteUser(userId: number): Promise<void> {
  const res = await fetch(`/api/admin/users/${userId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || "Failed to delete user");
  }
}
