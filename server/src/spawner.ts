import 'dotenv/config'
import type { NextFunction, Request, Response } from 'express'
import express from 'express'
import session from 'express-session'
import { execSync, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import passport from 'passport'
import { Strategy as GitHubStrategy } from 'passport-github2'
import type { VerifyCallback } from 'passport-oauth2'
import {
  addAllowedUser,
  addPackageSet,
  createProject,
  deleteProject,
  deleteUser,
  ensureUser,
  getAllowedUsers,
  getAllUsers,
  getAuthMethod,
  getAvatarUrl,
  getProjectById,
  getProjectByUserAndName,
  getProjectsByUser,
  getPublicProjectsByUsername,
  getSetting,
  getUserById,
  getUserByUsername,
  getUserCount,
  initDb,
  isFirstRunComplete,
  isUserAllowed,
  PROJECT_NAME_RE,
  removeAllowedUser,
  saveAuthMethod,
  setAdmin,
  setFirstRunComplete,
  setProjectPublic,
  setSetting,
  updateProject,
  upsertGithubUser,
  type UserRow,
} from './db.ts'
import type { EditorSessionInfo, SandboxMode } from './editorSessionManager.ts'
import { EditorSessionManager } from './editorSessionManager.ts'

const SPAWNER_PORT = 3002

// Configurable paths
const DATA_DIR = process.env.DATA_DIR ?? '/data'
const OPENVSCODE_SERVER_DIR = process.env.OPENVSCODE_SERVER_DIR ?? '/app/.openvscode-server'
const VSCODE_EXTENSIONS_DIR = process.env.VSCODE_EXTENSIONS_DIR ?? '/app/.vscode-extensions'
const NGINX_CONF_DIR = process.env.NGINX_CONF_DIR ?? '/etc/nginx'
const NGINX_LOG_DIR = process.env.NGINX_LOG_DIR ?? '/var/log/nginx'

// Derived paths
const ELAN_DIR = path.join(DATA_DIR, 'elan')
const WORKSPACES_DIR = path.join(DATA_DIR, 'workspaces')
const PACKAGE_SETS_DIR = path.join(DATA_DIR, 'package-sets')
const TEMPLATES_DIR = path.join(DATA_DIR, 'templates')
const DB_DIR = path.join(DATA_DIR, 'db')
const DB_PATH = path.join(DB_DIR, 'lean-workbench.db')

// Relative paths
const SCRIPTS_DIR = path.join(import.meta.dirname, '..', '..', 'scripts')
const PUBLIC_DIR = path.join(import.meta.dirname, '..', 'public')
const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'migrations')

const USERNAME_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/

const IS_PROD = process.env.NODE_ENV === 'production'
const SANDBOX_MODE: SandboxMode = process.env.SANDBOX_MODE === 'off' ? 'off' : 'bubblewrap'
if (SANDBOX_MODE === 'off') {
  console.warn('[spawner] Sandboxing is off. VSCode sessions will have full access to the host machine.')
}

// --- Setup state ---

// DB is always created at startup (schema + first_run row)
fs.mkdirSync(DB_DIR, { recursive: true })
initDb(DB_PATH, MIGRATIONS_DIR)

let setupComplete = isFirstRunComplete()
let seedingInProgress = false

interface SeedEvent {
  type: 'log' | 'progress' | 'done' | 'error'
  line?: string
  step?: number
  total?: number
  label?: string
  message?: string
}
const seedEvents: SeedEvent[] = []
const PROGRESS_RE = /^\[progress (\d+)\/(\d+) (.+)\]$/

// --- OAuth config (from DB, falling back to env vars) ---

interface GithubOAuthConfig {
  clientId: string
  clientSecret: string
  callbackUrl?: string
}

function getGithubConfig(): GithubOAuthConfig | null {
  // DB takes priority
  const row = getAuthMethod('github_oauth') as GithubOAuthConfig | null
  if (row?.clientId) return row
  // Fall back to env vars (for development)
  if (process.env.GITHUB_CLIENT_ID) {
    return {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      callbackUrl: process.env.CALLBACK_URL,
    }
  }
  return null
}

function getUserSessionSecret(): string {
  const row = getAuthMethod('session') as { secret: string } | null
  if (row?.secret) return row.secret
  return process.env.SESSION_SECRET ?? 'lean-workbench-dev-secret'
}

let githubConfig = getGithubConfig()

function registerGithubStrategy(config: GithubOAuthConfig): void {
  passport.use(
    new GitHubStrategy(
      {
        clientID: config.clientId,
        clientSecret: config.clientSecret,
        callbackURL: config.callbackUrl ?? 'http://localhost:3000/auth/github/callback',
      },
      (accessToken: string, refreshToken: string, profile: any, done: VerifyCallback) => {
        // Check allowlist before upserting
        if (!isUserAllowed(profile.username)) {
          done(null, false, { message: 'not_allowed' } as any)
          return
        }
        const user = upsertGithubUser({
          github_id: parseInt(profile.id, 10),
          github_username: profile.username,
          display_name: profile.displayName,
          email: profile.emails?.[0]?.value,
          avatar_url: profile.photos?.[0]?.value,
        })
        // First user to log in becomes admin
        if (getUserCount() === 1 && !user.is_admin) {
          setAdmin(user.id, true)
          user.is_admin = true
        }
        done(null, user)
      },
    ),
  )
}

if (setupComplete) {
  console.log('[spawner] Setup complete, ready.')
} else {
  console.log('[spawner] First run — serving setup page.')
}

// --- Editor session management ---

const editorSessions = new EditorSessionManager({
  workspacesDir: WORKSPACES_DIR,
  elanDir: ELAN_DIR,
  openVscodeServerDir: OPENVSCODE_SERVER_DIR,
  vscodeExtensionsDir: VSCODE_EXTENSIONS_DIR,
  nginxConfDir: NGINX_CONF_DIR,
  nginxLogDir: NGINX_LOG_DIR,
  packageSetsDir: PACKAGE_SETS_DIR,
  sandboxMode: SANDBOX_MODE,
})

interface TemplateMetadata {
  name: string
  description?: string
  packageSet?: string | null
}

function readTemplateMetadata(templateId: string): TemplateMetadata | null {
  const metaPath = path.join(TEMPLATES_DIR, templateId, 'metadata.json')
  if (!fs.existsSync(metaPath)) return null
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
}

function listTemplates(): { id: string; name: string; description: string }[] {
  const result: { id: string; name: string; description: string }[] = [
    { id: 'blank', name: 'Blank', description: 'Empty workspace' },
  ]
  if (!fs.existsSync(TEMPLATES_DIR)) return result
  for (const entry of fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const meta = readTemplateMetadata(entry.name)
    if (!meta) continue
    result.push({
      id: entry.name,
      name: meta.name,
      description: meta.description ?? '',
    })
  }
  return result
}

const TEMPLATE_FILES = ['lean-toolchain', 'lakefile.toml', 'Main.lean', 'lake-manifest.json']

/** Seed a workspace from a template. Returns the packageSet name, or null. */
function seedTemplate(username: string, projectId: string, template: string): string | null {
  if (template === 'blank') return null

  const workspace = path.join(WORKSPACES_DIR, username, projectId)
  const sourceDir = path.join(TEMPLATES_DIR, template)
  const meta = readTemplateMetadata(template)
  if (!meta) {
    throw new Error(`Template "${template}" not found at ${sourceDir}`)
  }

  for (const file of TEMPLATE_FILES) {
    const src = path.join(sourceDir, file)
    const dst = path.join(workspace, file)
    if (!fs.existsSync(dst) && fs.existsSync(src)) {
      fs.copyFileSync(src, dst)
    }
  }

  const packageSet = meta.packageSet ?? null
  if (packageSet) {
    fs.mkdirSync(path.join(workspace, '.lake', 'packages'), { recursive: true })
  }

  return packageSet
}

// --- Auth helpers ---

function requireAuth(req: Request, res: Response): UserRow | null {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: 'Not logged in' })
    return null
  }
  return req.user as UserRow
}

function requireAdmin(req: Request, res: Response): UserRow | null {
  const user = requireAuth(req, res)
  if (!user) return null
  if (!user.is_admin) {
    res.status(403).json({ error: 'Forbidden' })
    return null
  }
  return user
}

// --- Express app ---

const app = express()
app.set('view engine', 'ejs')
app.set('views', PUBLIC_DIR)

// TODO: use a different session store. The default `MemoryStore` is "not designed for a production environment"
app.use(
  session({
    secret: getUserSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      // https://expressjs.com/en/advanced/best-practice-security.html#set-cookie-security-options
      // https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies#block_access_to_your_cookies
      secure: IS_PROD,
      httpOnly: true,
    },
  }),
)

app.use(passport.initialize())
app.use(passport.session())

// Register GitHub strategy if config already exists
if (githubConfig) {
  registerGithubStrategy(githubConfig)
}

passport.serializeUser((user, done) => done(null, (user as UserRow).id))
passport.deserializeUser((id, done) => {
  const user = getUserById(id as number)
  done(null, user ?? false)
})

app.use(express.json())
app.use(express.urlencoded({ extended: false }))

app.use('/static', express.static(PUBLIC_DIR))

// --- Setup routes (available before first-run is complete) ---

app.get('/setup', (_req: Request, res: Response) => {
  if (setupComplete) {
    res.redirect('/')
    return
  }
  res.render('setup')
})

app.get('/api/setup/status', (_req: Request, res: Response) => {
  res.json({
    configSaved: !!githubConfig,
    seeded: setupComplete,
    seeding: seedingInProgress,
  })
})

app.post('/api/setup/config', (req: Request, res: Response) => {
  if (setupComplete) {
    res.status(400).json({ error: 'Setup already complete' })
    return
  }

  const { githubClientId, githubClientSecret, callbackUrl } = req.body
  if (!githubClientId || !githubClientSecret) {
    res.status(400).json({ error: 'Client ID and Client Secret are required' })
    return
  }

  const config: GithubOAuthConfig = {
    clientId: githubClientId,
    clientSecret: githubClientSecret,
    callbackUrl: callbackUrl || undefined,
  }
  saveAuthMethod('github_oauth', config)

  // Auto-generate session secret if not already stored
  if (!getAuthMethod('session')) {
    saveAuthMethod('session', { secret: crypto.randomBytes(32).toString('base64') })
  }

  githubConfig = config
  registerGithubStrategy(config)

  res.json({ ok: true })
})

app.post('/api/setup/seed', (_req: Request, res: Response) => {
  if (setupComplete) {
    res.status(400).json({ error: 'Already seeded' })
    return
  }
  if (!githubConfig) {
    res.status(400).json({ error: 'Configure authentication first' })
    return
  }
  if (seedingInProgress) {
    res.status(409).json({ error: 'Seeding already in progress' })
    return
  }

  seedingInProgress = true
  seedEvents.length = 0

  const child = spawn('bash', [path.join(SCRIPTS_DIR, 'seed-volume.sh'), '--root', DATA_DIR], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  function processLine(line: string) {
    if (!line) return
    const m = PROGRESS_RE.exec(line)
    if (m) {
      seedEvents.push({ type: 'progress', step: parseInt(m[1]), total: parseInt(m[2]), label: m[3] })
    } else {
      seedEvents.push({ type: 'log', line })
    }
  }

  child.stdout.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) processLine(line)
  })
  child.stderr.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) processLine(line)
  })

  child.on('close', code => {
    seedingInProgress = false
    if (code === 0) {
      setFirstRunComplete()
      setupComplete = true
      seedEvents.push({ type: 'done' })
    } else {
      seedEvents.push({ type: 'error', message: `seed-volume.sh exited with code ${code}` })
    }
  })

  res.json({ ok: true })
})

app.get('/api/setup/stream', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  let cursor = 0
  const interval = setInterval(() => {
    while (cursor < seedEvents.length) {
      const event = seedEvents[cursor++]
      res.write(`data: ${JSON.stringify(event)}\n\n`)
      if (event.type === 'done' || event.type === 'error') {
        clearInterval(interval)
        res.end()
        return
      }
    }
    if (!seedingInProgress && cursor >= seedEvents.length) {
      clearInterval(interval)
      res.end()
    }
  }, 500)

  req.on('close', () => clearInterval(interval))
})

// --- Setup guard: redirect everything else if setup not complete ---

app.use((req: Request, res: Response, next: NextFunction) => {
  if (setupComplete) {
    next()
    return
  }

  // Allow static assets and setup routes through
  if (req.path.startsWith('/static/') || req.path.startsWith('/api/setup/') || req.path === '/api/health') {
    next()
    return
  }

  if (req.path.startsWith('/api/')) {
    res.status(503).json({ error: 'Setup required' })
    return
  }

  res.redirect('/setup')
})

// --- Auth routes ---

app.get('/auth/github', (req: Request, res: Response, next: NextFunction) => {
  if (!githubConfig) {
    res.status(503).send('GitHub OAuth not configured')
    return
  }
  passport.authenticate('github', { scope: ['user:email'] })(req, res, next)
})

app.get(
  '/auth/github/callback',
  (req: Request, res: Response, next: NextFunction) => {
    if (!githubConfig) {
      res.status(503).send('GitHub OAuth not configured')
      return
    }
    passport.authenticate('github', { failureRedirect: '/?error=not_allowed' })(req, res, next)
  },
  (req: Request, res: Response) => {
    const username = (req.user as UserRow)?.username ?? ''
    res.redirect(`/${username}/`)
  },
)

if (!IS_PROD) {
  // NOTE: GET requests should not modify state; but we don't care in dev mode.
  app.get('/dev-login', (req: Request, res: Response) => {
    const user = ensureUser('dev')
    req.login(user, err => {
      if (err) {
        res.status(500).send('Login failed')
        return
      }
      res.redirect('/dev/')
    })
  })

  app.get('/dev-admin-login', (req: Request, res: Response) => {
    const user = ensureUser('dev-admin')
    if (!user.is_admin) {
      setAdmin(user.id, true)
      user.is_admin = true
    }
    req.login(user, err => {
      if (err) {
        res.status(500).send('Login failed')
        return
      }
      res.redirect('/dev-admin/')
    })
  })
}

app.post('/logout', (req: Request, res: Response) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.clearCookie('connect.sid')
      res.redirect('/')
    })
  })
})

// --- API routes (must come before /:username/ params) ---

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' })
})

app.get('/api/templates', (_req: Request, res: Response) => {
  res.json(listTemplates())
})

app.get('/api/projects', (req: Request, res: Response) => {
  const user = requireAuth(req, res)
  if (!user) return
  res.json(getProjectsByUser(user.id))
})

app.get('/api/admin/status', (req: Request, res: Response) => {
  const user = requireAdmin(req, res)
  if (!user) return
  const result: Record<string, EditorSessionInfo & { alive: boolean }> = {}
  for (const { key, info, alive } of editorSessions.listSessions()) {
    result[key] = { ...info, alive }
  }
  res.json({ editorSessions: result })
})

app.post('/api/projects', (req: Request, res: Response) => {
  const user = requireAuth(req, res)
  if (!user) return

  const { name, template = 'blank' } = req.body
  if (!name || !PROJECT_NAME_RE.test(name)) {
    res.status(400).json({ error: 'Invalid project name' })
    return
  }

  // Validate template exists
  if (template !== 'blank') {
    const meta = readTemplateMetadata(template)
    if (!meta) {
      res.status(400).json({ error: `Template "${template}" not found` })
      return
    }
    if (meta.packageSet) {
      const packagesFile = path.join(PACKAGE_SETS_DIR, meta.packageSet, 'packages.txt')
      if (!fs.existsSync(packagesFile)) {
        res.status(500).json({ error: `Package set "${meta.packageSet}" not found. Run scripts/seed-volume.sh first.` })
        return
      }
    }
  }

  const existing = getProjectByUserAndName(user.id, name)
  if (existing) {
    res.status(409).json({ error: 'Project already exists' })
    return
  }

  const project = createProject(user.id, name, template)

  // Seed template files into workspace
  const workspace = path.join(WORKSPACES_DIR, user.username, project.id)
  fs.mkdirSync(workspace, { recursive: true })
  const packageSet = seedTemplate(user.username, project.id, template)
  if (packageSet) {
    addPackageSet(project.id, packageSet)
  }

  res.json(project)
})

app.put('/api/projects/:projectId', (req: Request<{ projectId: string }>, res: Response) => {
  const user = requireAuth(req, res)
  if (!user) return

  const project = getProjectById(req.params.projectId)
  if (!project || project.user_id !== user.id) {
    res.status(404).json({ error: 'Project not found' })
    return
  }

  const { name } = req.body
  if (!name || !PROJECT_NAME_RE.test(name)) {
    res.status(400).json({ error: 'Invalid project name' })
    return
  }

  if (name !== project.name) {
    editorSessions.killSession(user.username, project.id)
  }

  updateProject(project.id, name)
  res.json({ ok: true })
})

app.delete('/api/projects/:projectId', (req: Request<{ projectId: string }>, res: Response) => {
  const user = requireAuth(req, res)
  if (!user) return

  const project = getProjectById(req.params.projectId)
  if (!project || project.user_id !== user.id) {
    res.status(404).json({ error: 'Project not found' })
    return
  }

  editorSessions.killSession(user.username, project.id)
  deleteProject(project.id)
  res.json({ ok: true })
})

app.put('/api/projects/:projectId/visibility', (req: Request<{ projectId: string }>, res: Response) => {
  const user = requireAuth(req, res)
  if (!user) return

  const project = getProjectById(req.params.projectId)
  if (!project || project.user_id !== user.id) {
    res.status(404).json({ error: 'Project not found' })
    return
  }

  const { public: isPublic } = req.body
  if (typeof isPublic !== 'boolean') {
    res.status(400).json({ error: '"public" must be a boolean' })
    return
  }

  setProjectPublic(project.id, isPublic)
  res.json({ ok: true })
})

app.put(
  '/api/editor-sessions/:ownerUsername/:projectName',
  async (req: Request<{ ownerUsername: string; projectName: string }>, res: Response) => {
    const viewer = requireAuth(req, res)
    if (!viewer) return

    const { ownerUsername, projectName } = req.params
    if (!USERNAME_RE.test(ownerUsername)) {
      res.status(400).json({ error: 'Malformed username' })
      return
    }

    const owner = getUserByUsername(ownerUsername)
    if (!owner) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const project = getProjectByUserAndName(owner.id, projectName)
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }

    const isOwner = viewer.username === ownerUsername
    if (!isOwner && !project.public) {
      // NOTE: 404 to prevent enumeration
      res.status(404).json({ error: 'Project not found' })
      return
    }

    try {
      await editorSessions.startSession(viewer.username, ownerUsername, projectName, project.id)
    } catch (err) {
      console.error('Failed to start editor session:', (err as Error).message)
      res.status(500).json({ error: 'Failed to start editor session' })
      return
    }

    const encodedName = encodeURIComponent(projectName)
    res.json({ iframeSrc: `/_vs/${viewer.username}/${ownerUsername}/${encodedName}/` })
  },
)

app.get('/api/users/:username/projects', (req: Request<{ username: string }>, res: Response) => {
  const viewer = requireAuth(req, res)
  if (!viewer) return

  const { username } = req.params
  if (!USERNAME_RE.test(username)) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  if (viewer.username === username) {
    res.json(getProjectsByUser(viewer.id))
  } else {
    res.json(getPublicProjectsByUsername(username))
  }
})

// --- Admin routes ---

app.get('/admin', (req: Request, res: Response) => {
  const user = requireAdmin(req, res)
  if (!user) return
  const avatarUrl = getAvatarUrl(user.id)
  res.render('admin', { username: user.username, avatarUrl, isAdmin: true })
})

app.delete(
  '/api/admin/editor-sessions/:viewer/:projectId',
  (req: Request<{ viewer: string; projectId: string }>, res: Response) => {
    const user = requireAdmin(req, res)
    if (!user) return
    editorSessions.killSession(req.params.viewer, req.params.projectId)
    res.json({ ok: true })
  },
)

app.get('/api/admin/settings', (req: Request, res: Response) => {
  const user = requireAdmin(req, res)
  if (!user) return
  res.json({ registrationMode: getSetting('registration_mode') ?? 'open' })
})

app.put('/api/admin/settings', (req: Request, res: Response) => {
  const user = requireAdmin(req, res)
  if (!user) return
  const { registrationMode } = req.body
  if (registrationMode !== 'open' && registrationMode !== 'restricted') {
    res.status(400).json({ error: 'Invalid registration mode' })
    return
  }
  setSetting('registration_mode', registrationMode)
  res.json({ ok: true })
})

function parseMeminfo(): Record<string, number> {
  const text = fs.readFileSync('/proc/meminfo', 'utf8')
  const result: Record<string, number> = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)/)
    if (m) result[m[1]] = parseInt(m[2], 10) * 1024 // kB -> bytes
  }
  return result
}

app.get('/api/admin/health', (req: Request, res: Response) => {
  const user = requireAdmin(req, res)
  if (!user) return

  // Disk usage
  let dataVolumeDisk = { total: '?', used: '?', available: '?', percent: '?' }
  try {
    const dfOut = execSync('df -h /data', { encoding: 'utf8' })
    const lines = dfOut.trim().split('\n')
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/)
      dataVolumeDisk = {
        total: parts[1] ?? '?',
        used: parts[2] ?? '?',
        available: parts[3] ?? '?',
        percent: parts[4] ?? '?',
      }
    }
  } catch {
    /* ignore df failures */
  }

  // Memory from /proc/meminfo
  const meminfo = parseMeminfo()

  // Load average from /proc/loadavg
  let loadAvg = [0, 0, 0]
  try {
    const text = fs.readFileSync('/proc/loadavg', 'utf8')
    const parts = text.split(' ')
    loadAvg = [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])]
  } catch {
    /* ignore */
  }

  res.json({
    activeEditorSessions: editorSessions.sessionCount,
    dataVolumeDisk,
    uptime: process.uptime(),
    memory: {
      total: meminfo.MemTotal ?? 0,
      available: meminfo.MemAvailable ?? 0,
      swapTotal: meminfo.SwapTotal ?? 0,
      swapFree: meminfo.SwapFree ?? 0,
    },
    loadAvg,
  })
})

app.get('/api/admin/disk-usage', (req: Request, res: Response) => {
  const user = requireAdmin(req, res)
  if (!user) return
  try {
    const out = execSync('du -sh /data/workspaces', { encoding: 'utf8', timeout: 30_000 })
    const size = out.split('\t')[0] ?? '?'
    res.json({ workspaces: size })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/admin/allowed-users', (req: Request, res: Response) => {
  const user = requireAdmin(req, res)
  if (!user) return
  res.json(getAllowedUsers())
})

app.post('/api/admin/allowed-users', (req: Request, res: Response) => {
  const user = requireAdmin(req, res)
  if (!user) return
  const { username } = req.body
  if (!username || typeof username !== 'string') {
    res.status(400).json({ error: 'Username is required' })
    return
  }
  addAllowedUser(username.trim())
  res.json({ ok: true })
})

app.delete('/api/admin/allowed-users/:username', (req: Request<{ username: string }>, res: Response) => {
  const user = requireAdmin(req, res)
  if (!user) return
  removeAllowedUser(req.params.username)
  res.json({ ok: true })
})

app.get('/api/admin/users', (req: Request, res: Response) => {
  const user = requireAdmin(req, res)
  if (!user) return
  const users = getAllUsers().map(u => ({
    id: u.id,
    username: u.username,
    is_admin: u.is_admin,
    created_at: u.created_at,
  }))
  res.json(users)
})

app.get('/api/admin/auth/github', (req: Request, res: Response) => {
  const user = requireAdmin(req, res)
  if (!user) return
  const config = getAuthMethod('github_oauth') as GithubOAuthConfig | null
  if (!config) {
    res.json({ clientId: '', callbackUrl: '' })
    return
  }
  // Never return the client secret
  res.json({ clientId: config.clientId, callbackUrl: config.callbackUrl ?? '' })
})

app.put('/api/admin/auth/github', (req: Request, res: Response) => {
  const user = requireAdmin(req, res)
  if (!user) return
  const { clientId, clientSecret, callbackUrl } = req.body
  if (!clientId || typeof clientId !== 'string') {
    res.status(400).json({ error: 'clientId is required' })
    return
  }
  if (!callbackUrl || typeof callbackUrl !== 'string') {
    res.status(400).json({ error: 'callbackUrl is required' })
    return
  }
  // If clientSecret is omitted or empty, preserve the existing one
  let resolvedSecret = clientSecret
  if (!resolvedSecret) {
    const existing = getAuthMethod('github_oauth') as GithubOAuthConfig | null
    if (!existing?.clientSecret) {
      res.status(400).json({ error: 'clientSecret is required (no existing secret to preserve)' })
      return
    }
    resolvedSecret = existing.clientSecret
  }
  const newConfig: GithubOAuthConfig = {
    clientId,
    clientSecret: resolvedSecret,
    callbackUrl,
  }
  saveAuthMethod('github_oauth', newConfig)
  githubConfig = newConfig
  registerGithubStrategy(newConfig)
  res.json({ ok: true })
})

app.put('/api/admin/users/:id/admin', (req: Request, res: Response) => {
  const admin = requireAdmin(req, res)
  if (!admin) return

  const targetId = Number(req.params.id)
  if (isNaN(targetId)) {
    res.status(400).json({ error: 'Invalid user ID' })
    return
  }
  if (targetId === admin.id) {
    res.status(400).json({ error: 'Cannot change your own admin status' })
    return
  }

  const target = getUserById(targetId)
  if (!target) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  const { admin: value } = req.body
  if (typeof value !== 'boolean') {
    res.status(400).json({ error: 'admin must be a boolean' })
    return
  }

  setAdmin(targetId, value)
  res.json({ ok: true })
})

app.delete('/api/admin/users/:id', (req: Request, res: Response) => {
  const admin = requireAdmin(req, res)
  if (!admin) return

  const targetId = Number(req.params.id)
  if (isNaN(targetId)) {
    res.status(400).json({ error: 'Invalid user ID' })
    return
  }
  if (targetId === admin.id) {
    res.status(400).json({ error: 'Cannot delete yourself' })
    return
  }

  const target = getUserById(targetId)
  if (!target) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  // Kill all active editor sessions for this user
  for (const { key, info } of editorSessions.listSessions()) {
    const [sessionUser] = key.split('/')
    if (sessionUser === target.username) {
      editorSessions.killSession(target.username, info.projectId)
    }
  }

  // Remove workspace directory
  const userWorkspaceDir = path.join(WORKSPACES_DIR, target.username)
  fs.rmSync(userWorkspaceDir, { recursive: true, force: true })

  // Delete from database (cascades to projects, admins, auth_github, etc.)
  deleteUser(targetId)

  res.json({ ok: true })
})

// --- Page routes ---

app.get('/', (req: Request, res: Response) => {
  let user: { username: string; avatarUrl: string | null; isAdmin: boolean } | null = null
  if (req.isAuthenticated()) {
    const u = req.user as UserRow
    user = { username: u.username, avatarUrl: getAvatarUrl(u.id), isAdmin: u.is_admin }
  }
  const githubEnabled = !!githubConfig
  res.render('landing', { user, devMode: !IS_PROD, githubEnabled })
})

app.get('/:username/', (req: Request<{ username: string }>, res: Response) => {
  const { username } = req.params
  if (!USERNAME_RE.test(username)) {
    res.redirect('/')
    return
  }
  const viewer = requireAuth(req, res)
  if (!viewer) return
  const pageUser = getUserByUsername(username)
  if (!pageUser) {
    res.status(404).send('User not found')
    return
  }

  const isOwner = viewer.username === username
  const avatarUrl = getAvatarUrl(viewer.id)
  res.render('profile', { username, isAdmin: viewer.is_admin, avatarUrl, isOwner })
})

app.get('/:username/:projectName/', (req: Request<{ username: string; projectName: string }>, res: Response) => {
  const { username: ownerUsername, projectName } = req.params
  if (!USERNAME_RE.test(ownerUsername)) {
    res.status(400).send('Malformed username')
    return
  }
  const viewer = requireAuth(req, res)
  if (!viewer) return
  const owner = getUserByUsername(ownerUsername)
  if (!owner) {
    res.status(404).send('User not found')
    return
  }

  const project = getProjectByUserAndName(owner.id, projectName)
  if (!project) {
    res.status(404).send('Project not found')
    return
  }

  const isOwner = viewer.username === ownerUsername
  if (!isOwner && !project.public) {
    // NOTE: 404 to prevent enumeration
    res.status(404).send('Project not found')
    return
  }

  const avatarUrl = getAvatarUrl(viewer.id)
  res.render('session', {
    ownerUsername,
    viewerUsername: viewer.username,
    projectName,
    avatarUrl,
    isOwner,
    isAdmin: viewer.is_admin,
  })
})

app.listen(SPAWNER_PORT, '127.0.0.1', () => {
  console.log(`[spawner] Spawner listening internally on 127.0.0.1:${SPAWNER_PORT}`)
})
