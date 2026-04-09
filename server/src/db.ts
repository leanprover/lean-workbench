import Database from 'better-sqlite3'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export interface UserRow {
  id: number
  username: string
  is_admin: boolean
  created_at: string
  updated_at: string
}

export interface ProjectRow {
  id: string
  user_id: number
  name: string
  path: string
  template: string
  public: number
  created_at: string
  updated_at: string
}

let db: InstanceType<typeof Database> | null = null

function getDb(): InstanceType<typeof Database> {
  if (!db) throw new Error('Database not initialized — call initDb() first')
  return db
}

/** Close and reset the db handle (for testing). */
export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

export function initDb(dbPath: string, migrationsDir: string): void {
  if (db) return
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db, migrationsDir)
}

function runMigrations(db: InstanceType<typeof Database>, migrationsDir: string): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
  )`)

  const row = db.prepare(`SELECT version FROM schema_version`).get() as { version: number } | undefined
  const currentVersion = row?.version ?? 0

  const MIGRATION_RE = /^(\d+)-.*\.sql$/
  const allFiles = fs.readdirSync(migrationsDir)
  for (const f of allFiles) {
    if (!MIGRATION_RE.test(f)) {
      console.error(`[db] migrations: unexpected file "${f}" does not match NNN-name.sql pattern`)
    }
  }
  const migrations = allFiles
    .map(f => {
      const m = MIGRATION_RE.exec(f)
      return m ? { num: parseInt(m[1], 10), file: f } : null
    })
    .filter(x => x !== null)
    .sort((a, b) => a.num - b.num)

  for (const { num, file } of migrations) {
    if (num <= currentVersion) continue
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
    db.transaction(() => {
      db.exec(sql)
      if (currentVersion === 0 && num === 1) {
        db.prepare(`INSERT INTO schema_version (version) VALUES (?)`).run(num)
      } else {
        db.prepare(`UPDATE schema_version SET version = ?`).run(num)
      }
    })()
  }

  // Ensure version row exists for fresh DBs with no migrations
  if (!db.prepare(`SELECT version FROM schema_version`).get()) {
    db.prepare(`INSERT INTO schema_version (version) VALUES (0)`).run()
  }
}

// --- User queries ---

export interface GitHubProfile {
  github_id: number
  github_username: string
  display_name?: string
  email?: string
  avatar_url?: string
}

export function upsertGithubUser(profile: GitHubProfile): UserRow {
  const d = getDb()
  const tx = d.transaction((): UserRow => {
    const existing = d
      .prepare(
        `SELECT u.id, u.username, u.created_at, u.updated_at
       FROM auth_github ag JOIN users u ON u.id = ag.user_id
       WHERE ag.github_id = ?`,
      )
      .get(profile.github_id) as { id: number; username: string; created_at: string; updated_at: string } | undefined

    if (existing) {
      d.prepare(
        `UPDATE auth_github SET github_username = ?, display_name = ?, email = ?, avatar_url = ?
         WHERE github_id = ?`,
      ).run(
        profile.github_username,
        profile.display_name ?? null,
        profile.email ?? null,
        profile.avatar_url ?? null,
        profile.github_id,
      )

      d.prepare(`UPDATE users SET updated_at = datetime('now') WHERE id = ?`).run(existing.id)

      return getUserById(existing.id)!
    }

    const username = profile.github_username.toLowerCase()
    const insertUser = d.prepare(`INSERT INTO users (username) VALUES (?)`)
    const { lastInsertRowid } = insertUser.run(username)
    const userId = Number(lastInsertRowid)

    d.prepare(
      `INSERT INTO auth_github (user_id, github_id, github_username, display_name, email, avatar_url)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      userId,
      profile.github_id,
      profile.github_username,
      profile.display_name ?? null,
      profile.email ?? null,
      profile.avatar_url ?? null,
    )

    return getUserById(userId)!
  })
  return tx()
}

export function getUserById(id: number): UserRow | undefined {
  const d = getDb()
  const row = d.prepare(`SELECT id, username, created_at, updated_at FROM users WHERE id = ?`).get(id) as
    | { id: number; username: string; created_at: string; updated_at: string }
    | undefined

  if (!row) return undefined

  const admin = d.prepare(`SELECT 1 FROM admins WHERE user_id = ?`).get(row.id)
  return { ...row, is_admin: !!admin }
}

export function getUserByUsername(username: string): UserRow | undefined {
  const d = getDb()
  const row = d.prepare(`SELECT id, username, created_at, updated_at FROM users WHERE username = ?`).get(username) as
    | { id: number; username: string; created_at: string; updated_at: string }
    | undefined

  if (!row) return undefined

  const admin = d.prepare(`SELECT 1 FROM admins WHERE user_id = ?`).get(row.id)
  return { ...row, is_admin: !!admin }
}

export function ensureUser(username: string): UserRow {
  const d = getDb()
  d.prepare(
    `INSERT INTO users (username) VALUES (?) ON CONFLICT(username) DO UPDATE SET updated_at = datetime('now')`,
  ).run(username)

  return getUserByUsername(username)!
}

export function getAvatarUrl(userId: number): string | null {
  const d = getDb()
  const row = d.prepare(`SELECT avatar_url FROM auth_github WHERE user_id = ?`).get(userId) as
    | { avatar_url: string | null }
    | undefined
  return row?.avatar_url ?? null
}

// --- Admin queries ---

export function isAdmin(userId: number): boolean {
  return !!getDb().prepare(`SELECT 1 FROM admins WHERE user_id = ?`).get(userId)
}

export function setAdmin(userId: number, value: boolean): void {
  const d = getDb()
  if (value) {
    d.prepare(`INSERT OR IGNORE INTO admins (user_id) VALUES (?)`).run(userId)
  } else {
    d.prepare(`DELETE FROM admins WHERE user_id = ?`).run(userId)
  }
}

export function getUserCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }
  return row.count
}

export function getAllUsers(): UserRow[] {
  const d = getDb()
  const rows = d.prepare(`SELECT id, username, created_at, updated_at FROM users ORDER BY username`).all() as {
    id: number
    username: string
    created_at: string
    updated_at: string
  }[]
  const adminSet = new Set((d.prepare(`SELECT user_id FROM admins`).all() as { user_id: number }[]).map(r => r.user_id))
  return rows.map(r => ({ ...r, is_admin: adminSet.has(r.id) }))
}

export function deleteUser(userId: number): void {
  getDb().prepare(`DELETE FROM users WHERE id = ?`).run(userId)
}

// --- Project queries ---

export const PROJECT_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,99}$/u

export function getProjectByUserAndName(userId: number, name: string): ProjectRow | undefined {
  return getDb().prepare(`SELECT * FROM projects WHERE user_id = ? AND name = ?`).get(userId, name) as
    | ProjectRow
    | undefined
}

export function createProject(userId: number, name: string, template: string = 'blank'): ProjectRow {
  const d = getDb()
  const id = crypto.randomUUID()
  d.prepare(`INSERT INTO projects (id, user_id, name, path, template) VALUES (?, ?, ?, ?, ?)`).run(
    id,
    userId,
    name,
    id,
    template,
  )

  return d.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as ProjectRow
}

export function getProjectsByUser(userId: number): ProjectRow[] {
  return getDb()
    .prepare(`SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC`)
    .all(userId) as ProjectRow[]
}

export function getProjectById(projectId: string): ProjectRow | undefined {
  return getDb().prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId) as ProjectRow | undefined
}

export function updateProject(projectId: string, name: string): void {
  getDb().prepare(`UPDATE projects SET name = ?, updated_at = datetime('now') WHERE id = ?`).run(name, projectId)
}

export function deleteProject(projectId: string): void {
  getDb().prepare(`DELETE FROM projects WHERE id = ?`).run(projectId)
}

export function setProjectPublic(projectId: string, isPublic: boolean): void {
  getDb()
    .prepare(`UPDATE projects SET public = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(isPublic ? 1 : 0, projectId)
}

export function getPublicProjectsByUsername(username: string): ProjectRow[] {
  return getDb()
    .prepare(
      `SELECT p.* FROM projects p
     JOIN users u ON u.id = p.user_id
     WHERE u.username = ? AND p.public = 1
     ORDER BY p.created_at DESC`,
    )
    .all(username) as ProjectRow[]
}

export function getProjectByOwnerUsernameAndName(ownerUsername: string, name: string): ProjectRow | undefined {
  return getDb()
    .prepare(
      `SELECT p.* FROM projects p
     JOIN users u ON u.id = p.user_id
     WHERE u.username = ? AND p.name = ?`,
    )
    .get(ownerUsername, name) as ProjectRow | undefined
}

// --- Package set queries ---

export function getPackageSets(projectId: string): string[] {
  const rows = getDb().prepare(`SELECT package_set FROM project_package_sets WHERE project_id = ?`).all(projectId) as {
    package_set: string
  }[]
  return rows.map(r => r.package_set)
}

export function addPackageSet(projectId: string, packageSet: string): void {
  getDb()
    .prepare(`INSERT OR IGNORE INTO project_package_sets (project_id, package_set) VALUES (?, ?)`)
    .run(projectId, packageSet)
}

// --- First-run queries ---

export function isFirstRunComplete(): boolean {
  const row = getDb().prepare(`SELECT complete FROM first_run WHERE id = 1`).get() as { complete: number }
  return row.complete === 1
}

export function setFirstRunComplete(): void {
  getDb().prepare(`UPDATE first_run SET complete = 1 WHERE id = 1`).run()
}

// --- Auth method queries ---

export interface AuthMethodRow {
  id: number
  type: string
  config: string
  created_at: string
}

export function getAuthMethod(type: string): object | null {
  const row = getDb().prepare(`SELECT config FROM auth_methods WHERE type = ?`).get(type) as
    | { config: string }
    | undefined
  return row ? JSON.parse(row.config) : null
}

export function saveAuthMethod(type: string, config: object): void {
  getDb()
    .prepare(
      `INSERT INTO auth_methods (type, config) VALUES (?, ?)
     ON CONFLICT(type) DO UPDATE SET config = excluded.config`,
    )
    .run(type, JSON.stringify(config))
}

// --- Settings queries ---

export function getSetting(key: string): string | null {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value)
}

// --- Allowed users queries ---

export function getAllowedUsers(): string[] {
  const rows = getDb().prepare(`SELECT github_username FROM allowed_users ORDER BY github_username`).all() as {
    github_username: string
  }[]
  return rows.map(r => r.github_username)
}

export function addAllowedUser(username: string): void {
  getDb().prepare(`INSERT OR IGNORE INTO allowed_users (github_username) VALUES (?)`).run(username.toLowerCase())
}

export function removeAllowedUser(username: string): void {
  getDb().prepare(`DELETE FROM allowed_users WHERE github_username = ?`).run(username.toLowerCase())
}

export function isUserAllowed(username: string): boolean {
  const mode = getSetting('registration_mode')
  if (mode !== 'restricted') return true
  const row = getDb().prepare(`SELECT 1 FROM allowed_users WHERE github_username = ?`).get(username.toLowerCase())
  return !!row
}
