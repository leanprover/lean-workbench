import { useState, useEffect, useRef } from "react";
import {
  fetchStatus,
  fetchAdminSettings,
  updateAdminSettings,
  fetchAllowedUsers,
  addAllowedUser,
  removeAllowedUser,
  fetchUsers,
  deleteUser,
} from "./api.ts";
import type { SessionStatus, AdminUser } from "./api.ts";

export function AdminPage({ username }: { username: string }) {
  const [sessions, setSessions] = useState<Record<string, SessionStatus>>({});
  const [registrationMode, setRegistrationMode] = useState<string>("open");
  const [savedMode, setSavedMode] = useState<string>("open");
  const [allowedUsers, setAllowedUsers] = useState<string[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [newUser, setNewUser] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const newUserRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([
      fetchStatus(),
      fetchAdminSettings(),
      fetchAllowedUsers(),
      fetchUsers(),
    ])
      .then(([sessions, settings, allowedUsers, users]) => {
        setSessions(sessions);
        setRegistrationMode(settings.registrationMode);
        setSavedMode(settings.registrationMode);
        setAllowedUsers(allowedUsers);
        setUsers(users);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleSaveMode() {
    setSaving(true);
    setError(null);
    try {
      await updateAdminSettings({ registrationMode });
      setSavedMode(registrationMode);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddUser() {
    const trimmed = newUser.trim().toLowerCase();
    if (!trimmed) return;
    setError(null);
    try {
      await addAllowedUser(trimmed);
      setAllowedUsers((prev) =>
        prev.includes(trimmed) ? prev : [...prev, trimmed].sort(),
      );
      setNewUser("");
      newUserRef.current?.focus();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleRemoveUser(u: string) {
    setError(null);
    try {
      await removeAllowedUser(u);
      setAllowedUsers((prev) => prev.filter((x) => x !== u));
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleDeleteUser(id: number) {
    setError(null);
    try {
      await deleteUser(id);
      setUsers((prev) => prev.filter((u) => u.id !== id));
      setConfirmDeleteId(null);
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (loading) return <main style={{ maxWidth: 700 }}><p>Loading...</p></main>;

  const alive = Object.entries(sessions).filter(([, s]) => s.alive);
  const modeChanged = registrationMode !== savedMode;

  return (
    <main style={{ maxWidth: 700 }}>
      <h1>Admin</h1>

      {error && <div style={{ color: "#dc2626", marginBottom: 16 }}>{error}</div>}

      <section style={{ marginBottom: 32 }}>
        <h2>Active sessions</h2>
        {alive.length === 0 ? (
          <p className="empty">No active sessions.</p>
        ) : (
          <ul className="project-list">
            {alive.map(([key, s]) => {
              const [user] = key.split("/");
              return (
                <li key={key}>
                  <div className="info">
                    <a href={`/${user}/`}>{user}</a>
                    <span style={{ color: "#90a4ae", margin: "0 0.25rem" }}>/</span>
                    <span style={{ fontSize: "0.85rem", color: "#666" }}>{s.projectId.slice(0, 8)}</span>
                  </div>
                  <div className="actions">
                    <span style={{ fontSize: "0.8rem", color: "#90a4ae" }}>port {s.port}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>Access control</h2>
        <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input
              type="radio"
              name="regMode"
              value="open"
              checked={registrationMode === "open"}
              onChange={() => setRegistrationMode("open")}
            />
            Open registration
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input
              type="radio"
              name="regMode"
              value="restricted"
              checked={registrationMode === "restricted"}
              onChange={() => setRegistrationMode("restricted")}
            />
            Restricted (allowlist only)
          </label>
        </div>
        {modeChanged && (
          <button onClick={handleSaveMode} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        )}
      </section>

      <section>
        <h2>Allowed users</h2>
        <p style={{ fontSize: "0.9rem", color: "#666", marginBottom: 12 }}>
          GitHub usernames allowed to register when mode is "restricted".
        </p>
        {allowedUsers.length === 0 ? (
          <p className="empty">No users in the allowlist.</p>
        ) : (
          <ul className="project-list">
            {allowedUsers.map((u) => (
              <li key={u}>
                <div className="info">{u}</div>
                <div className="actions">
                  <button className="delete" onClick={() => handleRemoveUser(u)}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input
            ref={newUserRef}
            type="text"
            value={newUser}
            onChange={(e) => setNewUser(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddUser();
            }}
            placeholder="GitHub username"
            style={{ flex: 1 }}
          />
          <button onClick={handleAddUser}>Add</button>
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>Registered users</h2>
        {users.length === 0 ? (
          <p className="empty">No users.</p>
        ) : (
          <ul className="project-list">
            {users.map((u) => (
              <li key={u.id}>
                <div className="info">
                  <a href={`/${u.username}/`}>{u.username}</a>
                  {u.is_admin && (
                    <span style={{ fontSize: "0.75rem", color: "#666", marginLeft: 8 }}>(admin)</span>
                  )}
                </div>
                <div className="actions">
                  {u.username === username ? (
                    <span style={{ fontSize: "0.8rem", color: "#90a4ae" }}>you</span>
                  ) : confirmDeleteId === u.id ? (
                    <>
                      <span style={{ fontSize: "0.85rem", color: "#dc2626", marginRight: 8 }}>
                        Delete user and all their data?
                      </span>
                      <button className="delete" onClick={() => handleDeleteUser(u.id)}>Confirm</button>
                      <button onClick={() => setConfirmDeleteId(null)} style={{ marginLeft: 4 }}>Cancel</button>
                    </>
                  ) : (
                    <button className="delete" onClick={() => setConfirmDeleteId(u.id)}>Delete</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
