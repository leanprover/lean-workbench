CREATE TABLE users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE admins (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id)
);

CREATE TABLE auth_github (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  github_id   INTEGER NOT NULL UNIQUE,
  github_username TEXT NOT NULL,
  display_name TEXT,
  email       TEXT,
  avatar_url  TEXT,
  PRIMARY KEY (user_id)
);

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  path        TEXT NOT NULL,
  template    TEXT NOT NULL DEFAULT 'blank',
  public      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);

CREATE TABLE project_package_sets (
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  package_set TEXT NOT NULL,
  PRIMARY KEY (project_id, package_set)
);

CREATE TABLE first_run (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  complete INTEGER NOT NULL DEFAULT 0
);
INSERT INTO first_run (id, complete) VALUES (1, 0);

CREATE TABLE auth_methods (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL UNIQUE,
  config     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key   TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES ('registration_mode', 'open');

CREATE TABLE allowed_users (
  github_username TEXT NOT NULL PRIMARY KEY
);
