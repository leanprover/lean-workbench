import Database from "better-sqlite3";

const DB_PATH = "/data/podserver.db";

export interface UserRow {
  id: number;
  username: string;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectRow {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  path: string;
  created_at: string;
  updated_at: string;
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admins (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id)
);

CREATE TABLE IF NOT EXISTS auth_github (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  github_id   INTEGER NOT NULL UNIQUE,
  github_username TEXT NOT NULL,
  display_name TEXT,
  email       TEXT,
  avatar_url  TEXT,
  PRIMARY KEY (user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  path        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);
`);

// --- User queries ---

export interface GitHubProfile {
  github_id: number;
  github_username: string;
  display_name?: string;
  email?: string;
  avatar_url?: string;
}

const upsertGithubUserTx = db.transaction((profile: GitHubProfile): UserRow => {
  const existing = db.prepare(
    `SELECT u.id, u.username, u.created_at, u.updated_at
     FROM auth_github ag JOIN users u ON u.id = ag.user_id
     WHERE ag.github_id = ?`
  ).get(profile.github_id) as { id: number; username: string; created_at: string; updated_at: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE auth_github SET github_username = ?, display_name = ?, email = ?, avatar_url = ?
       WHERE github_id = ?`
    ).run(profile.github_username, profile.display_name ?? null, profile.email ?? null, profile.avatar_url ?? null, profile.github_id);

    db.prepare(`UPDATE users SET updated_at = datetime('now') WHERE id = ?`).run(existing.id);

    return getUserById(existing.id)!;
  }

  const username = profile.github_username.toLowerCase();
  const insertUser = db.prepare(
    `INSERT INTO users (username) VALUES (?)`
  );
  const { lastInsertRowid } = insertUser.run(username);
  const userId = Number(lastInsertRowid);

  db.prepare(
    `INSERT INTO auth_github (user_id, github_id, github_username, display_name, email, avatar_url)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, profile.github_id, profile.github_username, profile.display_name ?? null, profile.email ?? null, profile.avatar_url ?? null);

  return getUserById(userId)!;
});

export function upsertGithubUser(profile: GitHubProfile): UserRow {
  return upsertGithubUserTx(profile);
}

export function getUserById(id: number): UserRow | undefined {
  const row = db.prepare(
    `SELECT id, username, created_at, updated_at FROM users WHERE id = ?`
  ).get(id) as { id: number; username: string; created_at: string; updated_at: string } | undefined;

  if (!row) return undefined;

  const admin = db.prepare(`SELECT 1 FROM admins WHERE user_id = ?`).get(row.id);
  return { ...row, is_admin: !!admin };
}

export function getUserByUsername(username: string): UserRow | undefined {
  const row = db.prepare(
    `SELECT id, username, created_at, updated_at FROM users WHERE username = ?`
  ).get(username) as { id: number; username: string; created_at: string; updated_at: string } | undefined;

  if (!row) return undefined;

  const admin = db.prepare(`SELECT 1 FROM admins WHERE user_id = ?`).get(row.id);
  return { ...row, is_admin: !!admin };
}

export function ensureUser(username: string): UserRow {
  db.prepare(
    `INSERT INTO users (username) VALUES (?) ON CONFLICT(username) DO UPDATE SET updated_at = datetime('now')`
  ).run(username);

  return getUserByUsername(username)!;
}

// --- Admin queries ---

export function isAdmin(userId: number): boolean {
  return !!db.prepare(`SELECT 1 FROM admins WHERE user_id = ?`).get(userId);
}

export function setAdmin(userId: number, value: boolean): void {
  if (value) {
    db.prepare(`INSERT OR IGNORE INTO admins (user_id) VALUES (?)`).run(userId);
  } else {
    db.prepare(`DELETE FROM admins WHERE user_id = ?`).run(userId);
  }
}

// --- Project queries ---

export function createProject(userId: number, name: string, description?: string): ProjectRow {
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO projects (user_id, name, description, path) VALUES (?, ?, ?, '')`
  ).run(userId, name, description ?? null);

  const id = Number(lastInsertRowid);
  db.prepare(`UPDATE projects SET path = ? WHERE id = ?`).run(String(id), id);

  return db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as ProjectRow;
}

export function getProjectsByUser(userId: number): ProjectRow[] {
  return db.prepare(`SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC`).all(userId) as ProjectRow[];
}

export function getProjectById(projectId: number): ProjectRow | undefined {
  return db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId) as ProjectRow | undefined;
}

export function updateProject(projectId: number, name: string, description: string | null): void {
  db.prepare(
    `UPDATE projects SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(name, description, projectId);
}

export function deleteProject(projectId: number): void {
  db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
}
