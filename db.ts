import crypto from "node:crypto";
import Database from "better-sqlite3";

export const DB_PATH = process.env.DB_PATH ?? "/data/db/lean-workbench.db";

export interface UserRow {
  id: number;
  username: string;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectRow {
  id: string;
  user_id: number;
  name: string;
  path: string;
  template: string;
  created_at: string;
  updated_at: string;
}

let db: InstanceType<typeof Database> | null = null;

function getDb(): InstanceType<typeof Database> {
  if (!db) throw new Error("Database not initialized — call initDb() first");
  return db;
}

export function initDb(): void {
  if (db) return;
  db = new Database(DB_PATH);
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
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  path        TEXT NOT NULL,
  template    TEXT NOT NULL DEFAULT 'blank',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS project_package_sets (
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  package_set TEXT NOT NULL,
  PRIMARY KEY (project_id, package_set)
);

CREATE TABLE IF NOT EXISTS first_run (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  complete INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO first_run (id, complete) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS auth_methods (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL UNIQUE,
  config     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

  // Migration: add template column if it doesn't exist (for existing DBs)
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN template TEXT NOT NULL DEFAULT 'blank'`);
  } catch {
    // column already exists
  }
}

// --- User queries ---

export interface GitHubProfile {
  github_id: number;
  github_username: string;
  display_name?: string;
  email?: string;
  avatar_url?: string;
}

export function upsertGithubUser(profile: GitHubProfile): UserRow {
  const d = getDb();
  const tx = d.transaction((): UserRow => {
    const existing = d.prepare(
      `SELECT u.id, u.username, u.created_at, u.updated_at
       FROM auth_github ag JOIN users u ON u.id = ag.user_id
       WHERE ag.github_id = ?`
    ).get(profile.github_id) as { id: number; username: string; created_at: string; updated_at: string } | undefined;

    if (existing) {
      d.prepare(
        `UPDATE auth_github SET github_username = ?, display_name = ?, email = ?, avatar_url = ?
         WHERE github_id = ?`
      ).run(profile.github_username, profile.display_name ?? null, profile.email ?? null, profile.avatar_url ?? null, profile.github_id);

      d.prepare(`UPDATE users SET updated_at = datetime('now') WHERE id = ?`).run(existing.id);

      return getUserById(existing.id)!;
    }

    const username = profile.github_username.toLowerCase();
    const insertUser = d.prepare(
      `INSERT INTO users (username) VALUES (?)`
    );
    const { lastInsertRowid } = insertUser.run(username);
    const userId = Number(lastInsertRowid);

    d.prepare(
      `INSERT INTO auth_github (user_id, github_id, github_username, display_name, email, avatar_url)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(userId, profile.github_id, profile.github_username, profile.display_name ?? null, profile.email ?? null, profile.avatar_url ?? null);

    return getUserById(userId)!;
  });
  return tx();
}

export function getUserById(id: number): UserRow | undefined {
  const d = getDb();
  const row = d.prepare(
    `SELECT id, username, created_at, updated_at FROM users WHERE id = ?`
  ).get(id) as { id: number; username: string; created_at: string; updated_at: string } | undefined;

  if (!row) return undefined;

  const admin = d.prepare(`SELECT 1 FROM admins WHERE user_id = ?`).get(row.id);
  return { ...row, is_admin: !!admin };
}

export function getUserByUsername(username: string): UserRow | undefined {
  const d = getDb();
  const row = d.prepare(
    `SELECT id, username, created_at, updated_at FROM users WHERE username = ?`
  ).get(username) as { id: number; username: string; created_at: string; updated_at: string } | undefined;

  if (!row) return undefined;

  const admin = d.prepare(`SELECT 1 FROM admins WHERE user_id = ?`).get(row.id);
  return { ...row, is_admin: !!admin };
}

export function ensureUser(username: string): UserRow {
  const d = getDb();
  d.prepare(
    `INSERT INTO users (username) VALUES (?) ON CONFLICT(username) DO UPDATE SET updated_at = datetime('now')`
  ).run(username);

  return getUserByUsername(username)!;
}

export function getAvatarUrl(userId: number): string | null {
  const d = getDb();
  const row = d.prepare(`SELECT avatar_url FROM auth_github WHERE user_id = ?`).get(userId) as { avatar_url: string | null } | undefined;
  return row?.avatar_url ?? null;
}

// --- Admin queries ---

export function isAdmin(userId: number): boolean {
  return !!getDb().prepare(`SELECT 1 FROM admins WHERE user_id = ?`).get(userId);
}

export function setAdmin(userId: number, value: boolean): void {
  const d = getDb();
  if (value) {
    d.prepare(`INSERT OR IGNORE INTO admins (user_id) VALUES (?)`).run(userId);
  } else {
    d.prepare(`DELETE FROM admins WHERE user_id = ?`).run(userId);
  }
}

export function getUserCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  return row.count;
}

// --- Project queries ---

export const PROJECT_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,99}$/u;

export function getProjectByUserAndName(userId: number, name: string): ProjectRow | undefined {
  return getDb().prepare(`SELECT * FROM projects WHERE user_id = ? AND name = ?`).get(userId, name) as ProjectRow | undefined;
}

export function createProject(userId: number, name: string, template: string = 'blank'): ProjectRow {
  const d = getDb();
  const id = crypto.randomUUID();
  d.prepare(
    `INSERT INTO projects (id, user_id, name, path, template) VALUES (?, ?, ?, ?, ?)`
  ).run(id, userId, name, id, template);

  return d.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as ProjectRow;
}

export function getProjectsByUser(userId: number): ProjectRow[] {
  return getDb().prepare(`SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC`).all(userId) as ProjectRow[];
}

export function getProjectById(projectId: string): ProjectRow | undefined {
  return getDb().prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId) as ProjectRow | undefined;
}

export function updateProject(projectId: string, name: string): void {
  getDb().prepare(
    `UPDATE projects SET name = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(name, projectId);
}

export function deleteProject(projectId: string): void {
  getDb().prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
}

// --- Package set queries ---

export function getPackageSets(projectId: string): string[] {
  const rows = getDb().prepare(
    `SELECT package_set FROM project_package_sets WHERE project_id = ?`
  ).all(projectId) as { package_set: string }[];
  return rows.map(r => r.package_set);
}

export function addPackageSet(projectId: string, packageSet: string): void {
  getDb().prepare(
    `INSERT OR IGNORE INTO project_package_sets (project_id, package_set) VALUES (?, ?)`
  ).run(projectId, packageSet);
}

// --- First-run queries ---

export function isFirstRunComplete(): boolean {
  const row = getDb().prepare(`SELECT complete FROM first_run WHERE id = 1`).get() as { complete: number };
  return row.complete === 1;
}

export function setFirstRunComplete(): void {
  getDb().prepare(`UPDATE first_run SET complete = 1 WHERE id = 1`).run();
}

// --- Auth method queries ---

export interface AuthMethodRow {
  id: number;
  type: string;
  config: string;
  created_at: string;
}

export function getAuthMethod(type: string): object | null {
  const row = getDb().prepare(`SELECT config FROM auth_methods WHERE type = ?`).get(type) as { config: string } | undefined;
  return row ? JSON.parse(row.config) : null;
}

export function saveAuthMethod(type: string, config: object): void {
  getDb().prepare(
    `INSERT INTO auth_methods (type, config) VALUES (?, ?)
     ON CONFLICT(type) DO UPDATE SET config = excluded.config`
  ).run(type, JSON.stringify(config));
}
