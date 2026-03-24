# Plan: View Other Users' Projects (CoW/Readonly)

status: planned

## Context

Currently, visiting `/:username/:projectName/` when you're not the owner redirects you to `/`. We want logged-in users to be able to view other users' **public** projects in a copy-on-write sandbox — they see the owner's files, can edit locally in an ephemeral tmpfs layer, but nothing persists and nothing touches the owner's workspace.

## Key Design Decision: uniform session URLs

Every session — whether the viewer is the owner or not — uses the same URL formula:

```
/_vs/{viewerUsername}/{ownerUsername}/{projectName}/
```

When Alice opens her own project, her iframe points to `/_vs/alice/alice/my-project/`. When Bob views it, his iframe points to `/_vs/bob/alice/my-project/`. Same code path, same computation. The `/_vs/` prefix acts as a top-level namespace for all proxied VS Code traffic, cleanly separated from page routes.

The **only** place owner vs. non-owner matters is the bwrap mount strategy:
- **Owner**: `--bind workspace sandboxProject` (persistent read-write)
- **Non-owner**: `--overlay-src workspace --tmp-overlay sandboxProject` (ephemeral CoW)

Session keys, nginx confs, iframe URLs, and cleanup all work uniformly.

## Changes by file

### 1. `db.ts` — schema + queries

- **Migration**: `ALTER TABLE projects ADD COLUMN public INTEGER NOT NULL DEFAULT 0`
- **Modify** `ProjectRow` interface to include `public: boolean`
- **New query** `setProjectPublic(projectId: string, isPublic: boolean)`
- **New query** `getPublicProjectsByUsername(username: string): ProjectRow[]` — returns public projects for a user (for profile pages viewed by non-owners)
- **New query** `getProjectByOwnerUsernameAndName(ownerUsername: string, name: string): ProjectRow | undefined` — joins `projects` + `users` to look up by owner username + project name

### 2. `spawner.ts` — auth, routing, spawn logic

#### a. Unify `spawnProject` to always include viewer

Refactor the signature to:

```ts
async function spawnProject(
  viewerUsername: string,
  ownerUsername: string,
  projectName: string,
  projectId: string,
): Promise<SessionInfo>
```

- **Session key**: always `${viewerUsername}/${projectId}`
- **nginx location**: always `/_vs/${viewerUsername}/${ownerUsername}/${encodedProjectName}/`
- **nginx conf file**: `${viewerUsername}-${projectId}.conf`
- **bwrap mount**: if `viewerUsername === ownerUsername`, use `--bind` (persistent); otherwise use `--overlay-src` + `--tmp-overlay` (CoW)
- **`ensureMachineSettings`**: call only when viewer is owner (non-owners get settings from the overlay or openvscode-server defaults)
- **Package overlays**: unchanged — applied on top of the workspace mount in both cases
- **`--server-base-path`**: matches the `/_vs/{viewer}/{owner}/{project}/` URL

#### b. Update `writeNginxConf`

Takes `viewerUsername`, `ownerUsername`, `projectName`, `projectId`, `port`. Writes the `/_vs/{viewer}/{owner}/{project}/` location block.

#### c. Update `killSession` / cleanup

Session key and conf filename now follow the new uniform pattern.

#### d. Relax auth on profile page route (`/:username/`)

Replace `requirePageOwner` with `requireAuth`. Pass `isOwner` to EJS.

```
GET /:username/
  - requireAuth
  - look up page user by username (404 if not found)
  - isOwner = (req.user.username === username)
  - render profile.ejs with { username, isAdmin, avatarUrl, isOwner }
```

#### e. New API endpoint for a user's projects

```
GET /api/users/:username/projects
  - requireAuth
  - if viewer is owner: return all projects
  - else: return only public projects
```

#### f. Relax auth on project page route (`/:username/:projectName/`)

```
GET /:username/:projectName/
  - requireAuth
  - look up owner by username, project by (owner.id, projectName)
  - if viewer is not owner: check project.public, else 403
  - spawnProject(viewerUsername, ownerUsername, projectName, projectId)
  - render session.ejs with { ownerUsername, viewerUsername, projectName, avatarUrl, iframeSrc }
```

#### g. Visibility toggle API route

```
PUT /api/projects/:projectId/visibility
  - requireAuth + ownership check
  - body: { public: boolean }
  - calls setProjectPublic()
```

### 3. `public/session.ejs` — uniform iframe src

Change iframe src from hardcoded `/<%= username %>/<%= encodeURIComponent(projectName) %>/_vs/` to `<%= iframeSrc %>` (computed server-side as `/_vs/${viewer}/${owner}/${project}/`).

Show a visual indicator when viewing someone else's project (e.g., "Viewing alice/my-project (ephemeral)").

### 4. `public/profile.ejs` — pass `isOwner` to React

```js
window.__DATA__ = { username: '...', isAdmin: ..., isOwner: true/false };
```

### 5. `client/src/api.ts`

- Add `public` field to `Project` interface
- New `fetchUserProjects(username: string): Promise<Project[]>` — `GET /api/users/:username/projects`
- New `setProjectVisibility(projectId: string, isPublic: boolean): Promise<void>` — `PUT /api/projects/:projectId/visibility`

### 6. `client/src/ProfilePage.tsx`

- Read `isOwner` from `window.__DATA__`
- If owner: current behavior + visibility toggle on each project row
- If not owner: fetch from `/api/users/:username/projects`, render read-only list (links only, no edit/delete/create)

## Implementation order

1. DB migration + new queries (`db.ts`)
2. Refactor `spawnProject` + `writeNginxConf` to uniform viewer-aware pattern (`spawner.ts`)
3. Relax auth on `/:username/` and `/:username/:projectName/`, add CoW bwrap path
4. Session page: parameterize iframe src, add visual indicator (`session.ejs`)
5. Visibility toggle: API route + frontend (`spawner.ts`, `api.ts`, `ProfilePage.tsx`)
6. Public profile page: new API endpoint + frontend for non-owner view

## Verification

1. Create two users (e.g., `dev` + another via dev-login)
2. As user A, create a project and toggle it to public
3. As user B, visit `/userA/` — should see the public project listed
4. Click the project link — should get a CoW VS Code session
5. Edit a file in the viewer session — changes should not appear in the owner's workspace
6. Refresh — should reconnect to the same session
7. Verify owner can still open their own project independently
8. Verify private projects are not visible to other users
