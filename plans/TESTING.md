# Testing & CI Plan

status: finished

## Overview

Add a unit test framework, write initial unit tests for the database layer and
route-level logic, and set up GitHub Actions CI to run them on every push/PR.

The existing shell scripts (`scripts/test-mathlib-workspace.sh`,
`scripts/test-setup-file.sh`) are integration tests that require Docker + bwrap
and a pre-built image. Those stay manual for now — they're too heavy for
standard CI runners.

## 1. Test framework: vitest

**Why vitest:** The client already uses Vite. Vitest is TypeScript-native, ESM-native,
fast, and has a built-in assertion library. No Babel/ts-jest config dance.

Install at the project root:
```
npm install -D vitest
```

Add to root `package.json`:
```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

Minimal `vitest.config.ts` at project root:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
  },
});
```

## 2. Unit tests: db.ts

`db.ts` is the most testable module — all pure data logic against SQLite.
better-sqlite3 supports in-memory databases, so tests can run without touching
the filesystem.

Create `db.test.ts` with tests for:

- **initDb** — schema creation succeeds, is idempotent
- **User CRUD** — ensureUser, getUserByUsername, getUserById
- **GitHub upsert** — upsertGithubUser creates user + auth_github row; second
  call updates rather than duplicating
- **Admin** — setAdmin/isAdmin toggle, first-user-becomes-admin not tested here
  (that's in the passport callback)
- **Project CRUD** — createProject, getProjectsByUser, updateProject,
  deleteProject, name uniqueness constraint
- **Project visibility** — setProjectPublic, getPublicProjectsByUsername
- **Package sets** — addPackageSet, getPackageSets
- **Settings** — getSetting/setSetting round-trip
- **Allowed users** — add/remove/isUserAllowed, registration mode interaction
- **First run** — isFirstRunComplete/setFirstRunComplete

Each test gets a fresh in-memory DB by pointing `DB_PATH` to `":memory:"` and
calling `initDb()`. A `beforeEach` helper resets the module-level `db` variable
(may need a small refactor to `initDb` to accept a path, or to export a
`resetDb` for testing).

### Refactor needed

`db.ts` currently uses a module-level singleton `db` and reads `DB_PATH` at
import time. To support in-memory test databases without env-var hacks, add:

```ts
export function initDb(dbPath?: string): void {
  if (db) return;
  db = new Database(dbPath ?? DB_PATH);
  // ... rest unchanged
}

/** Close and reset the db handle (for testing). */
export function closeDb(): void {
  if (db) { db.close(); db = null; }
}
```

Tests call `closeDb()` in `afterEach` and `initDb(":memory:")` in `beforeEach`.

## 3. Unit tests: route logic (spawner.ts)

The Express app in `spawner.ts` is tightly coupled to passport, filesystem, and
child_process. Full HTTP-level tests would need supertest and significant
mocking. **Defer this** — the db layer is where most of the testable logic
lives.

If we do add route tests later:
- `npm install -D supertest @types/supertest`
- Extract the Express app creation into a function so tests can import it
  without starting the server
- Mock `fs`, `child_process`, `passport` as needed

## 4. Client tests

The React client is small (AdminPage, ProfilePage, api.ts). Low priority.
If added later, vitest + @testing-library/react in `client/`.

## 5. GitHub Actions CI

Create `.github/workflows/test.yml`:

```yaml
name: Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci
      - run: npm test
```

This runs the vitest unit tests. Fast, no Docker needed.

## 6. Implementation order

1. Refactor `db.ts` — add `closeDb()`, make `initDb` accept optional path
2. Install vitest
3. Write `db.test.ts`
4. Add `npm test` script
5. Create `.github/workflows/test.yml`
6. Verify CI passes on a test push/PR

## 7. Future work (not in this round)

- Route-level tests with supertest
- Client component tests
- Integration test CI job (needs self-hosted runner with Docker + bwrap)
- Coverage reporting / thresholds
