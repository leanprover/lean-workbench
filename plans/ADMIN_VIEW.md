# Admin Page Plan

status: proposed

## Context

The workbench currently has no way to control who can register. Any GitHub user who completes OAuth gets an account. The admin needs a dedicated page to monitor active sessions and manage access control settings (open registration vs. allowlist-only, with a list of allowed GitHub handles).

There's a small existing admin feature — an `ActiveSessions` component on the profile page — that will move to the new admin page.

## Database Changes (`db.ts`)

### New table: `settings`
```sql
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES ('registration_mode', 'open');
```
Two possible values for `registration_mode`: `'open'` or `'restricted'`.

### New table: `allowed_users`
```sql
CREATE TABLE IF NOT EXISTS allowed_users (
  github_username TEXT NOT NULL PRIMARY KEY
);
```
Stores lowercase GitHub usernames. Only checked when `registration_mode = 'restricted'`.

### New db.ts functions
- `getSetting(key): string | null`
- `setSetting(key, value): void`
- `getAllowedUsers(): string[]`
- `addAllowedUser(username): void`
- `removeAllowedUser(username): void`
- `isUserAllowed(username): boolean` — returns true if mode is `'open'`, or if mode is `'restricted'` and username is in the allowlist

## Server Changes (`spawner.ts`)

### New routes
All require auth + admin. Place before the `/:username/` catch-all routes.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin` | Render `admin.ejs` |
| `GET` | `/api/admin/settings` | Return `{ registrationMode }` |
| `PUT` | `/api/admin/settings` | Update `registrationMode` |
| `GET` | `/api/admin/allowed-users` | Return array of usernames |
| `POST` | `/api/admin/allowed-users` | Add a username (body: `{ username }`) |
| `DELETE` | `/api/admin/allowed-users/:username` | Remove a username |

### Auth guard helper
Add `requireAdmin(req, res)` helper (similar to `requireAuth` but also checks `is_admin`).

### OAuth allowlist enforcement
In `registerGithubStrategy`, adjust the strategy callback:
1. Check `isUserAllowed(profile.github_username)` *before* upserting
2. If not allowed, call `done(null, false, { message: "not allowed" })`
3. If allowed, proceed with `upsertGithubUser` as before

The `failureRedirect: "/"` in the callback route will handle the redirect. Add a query param like `?error=not_allowed` so the landing page can display a message.

### Navigation
Add an "Admin" link to the avatar dropdown menu in EJS templates that have one.

## Client Changes

### New files
- `client/src/admin.tsx` — entry point (mounts `AdminPage`)
- `client/src/AdminPage.tsx` — main component

### AdminPage sections

**1. Active Sessions** — moved from `ProfilePage.tsx`
- Reuse the existing `fetchStatus` API call and `SessionStatus` type
- Remove `ActiveSessions` component and admin-related code from `ProfilePage.tsx`

**2. Access Control Settings**
- Radio buttons or toggle: "Open" vs "Restricted"
- Save button that calls `PUT /api/admin/settings`
- When "Restricted" is selected, show the allowlist section

**3. User Allowlist** (shown when mode is restricted, or always visible)
- List of allowed GitHub usernames with delete buttons
- Text input + "Add" button to add a username
- Uses the `/api/admin/allowed-users` endpoints

### API additions (`client/src/api.ts`)
- `fetchAdminSettings(): Promise<{ registrationMode: string }>`
- `updateAdminSettings(settings): Promise<void>`
- `fetchAllowedUsers(): Promise<string[]>`
- `addAllowedUser(username): Promise<void>`
- `removeAllowedUser(username): Promise<void>`

## Build Changes (`client/vite.config.ts`)

Add `admin.tsx` as a second entry point:
```ts
rollupOptions: {
  input: {
    profile: "src/profile.tsx",
    admin: "src/admin.tsx",
  },
  output: {
    entryFileNames: "[name].js",
  },
},
```

## New EJS Template (`public/admin.ejs`)

Similar structure to `profile.ejs` — same navbar with breadcrumb showing "Admin", same avatar dropdown. Loads `admin.js` instead of `profile.js`. Passes `username` and `avatarUrl` via `window.__DATA__`.

## Landing page error display

Update `landing.ejs` to show a message when `?error=not_allowed` is in the URL, e.g. "Your GitHub account is not on the allowlist. Contact an administrator."

## Files to modify
- `db.ts` — new tables + query functions
- `spawner.ts` — new routes, OAuth guard, admin nav link
- `client/src/api.ts` — new API functions
- `client/src/ProfilePage.tsx` — remove ActiveSessions
- `client/vite.config.ts` — add admin entry point
- `public/profile.ejs` — add Admin link in avatar dropdown
- `public/landing.ejs` — show not-allowed error message

## Files to create
- `client/src/admin.tsx` — entry point
- `client/src/AdminPage.tsx` — admin page component
- `public/admin.ejs` — admin page template

## Verification
1. `cd client && npm run build` — confirm both `profile.js` and `admin.js` are emitted to `public/dist/`
2. Start the server, log in as admin (first user / dev-login), visit `/admin`
3. Verify active sessions section shows running sessions
4. Toggle registration mode to "restricted", add a GitHub username, verify it persists on page reload
5. In a separate browser / incognito, attempt GitHub login with a non-allowlisted account — should be redirected to landing page with error message
6. Add that account to the allowlist, try again — should succeed
7. Toggle back to "open" — any GitHub user should be able to log in
