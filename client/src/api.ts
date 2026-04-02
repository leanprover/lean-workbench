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

// --- Admin sessions API ---

export async function killSession(viewer: string, projectId: string): Promise<void> {
  const res = await fetch(`/api/admin/sessions/${encodeURIComponent(viewer)}/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || "Failed to kill session");
  }
}

// --- Admin health API ---

export interface HealthInfo {
  activeSessions: number;
  dataVolumeDisk: { total: string; used: string; available: string; percent: string };
  uptime: number;
  memory: { total: number; available: number; swapTotal: number; swapFree: number };
  loadAvg: [number, number, number];
}

export async function fetchHealth(): Promise<HealthInfo> {
  const res = await fetch("/api/admin/health");
  if (!res.ok) throw new Error("Failed to fetch health info");
  return res.json();
}

export async function fetchDiskUsage(): Promise<{ workspaces: string }> {
  const res = await fetch("/api/admin/disk-usage");
  if (!res.ok) throw new Error("Failed to fetch disk usage");
  return res.json();
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

export async function setUserAdmin(userId: number, admin: boolean): Promise<void> {
  const res = await fetch(`/api/admin/users/${userId}/admin`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ admin }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || "Failed to update admin status");
  }
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

// --- Admin OAuth API ---

export interface OAuthConfig {
  clientId: string;
  callbackUrl: string;
}

export async function fetchOAuthConfig(): Promise<OAuthConfig> {
  const res = await fetch("/api/admin/auth/github");
  if (!res.ok) throw new Error("Failed to fetch OAuth config");
  return res.json();
}

export async function updateOAuthConfig(config: {
  clientId: string;
  clientSecret?: string;
  callbackUrl: string;
}): Promise<void> {
  const res = await fetch("/api/admin/auth/github", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || "Failed to update OAuth config");
  }
}
