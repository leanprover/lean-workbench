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
  killSession,
  fetchOAuthConfig,
  updateOAuthConfig,
  setUserAdmin,
} from "./api.ts";
import type { SessionStatus, AdminUser, OAuthConfig } from "./api.ts";

type ConfirmAction = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
};

function ConfirmDialog({ action, onClose }: { action: ConfirmAction; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function handleConfirm() {
    setBusy(true);
    try {
      await action.onConfirm();
      onClose();
    } catch {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialogRef} onClose={onClose} style={{
      border: "1px solid #E4EBF3", borderRadius: 8, padding: 24, maxWidth: 400,
      position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", margin: 0,
    }}>
      <h3 style={{ margin: "0 0 8px" }}>{action.title}</h3>
      <p style={{ margin: "0 0 20px", color: "#555" }}>{action.message}</p>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} disabled={busy}>Cancel</button>
        <button
          className={action.danger ? "delete" : ""}
          onClick={handleConfirm}
          disabled={busy}
          style={action.danger ? { background: "#dc2626", color: "#fff", borderColor: "#dc2626" } : {}}
        >
          {busy ? "..." : action.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

export function AdminPage({ username }: { username: string }) {
  const [sessions, setSessions] = useState<Record<string, SessionStatus>>({});
  const [registrationMode, setRegistrationMode] = useState<string>("open");
  const [savedMode, setSavedMode] = useState<string>("open");
  const [allowedUsers, setAllowedUsers] = useState<string[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [oauthConfig, setOauthConfig] = useState<OAuthConfig>({ clientId: "", callbackUrl: "" });
  const [oauthEditing, setOauthEditing] = useState(false);
  const [oauthForm, setOauthForm] = useState({ clientId: "", clientSecret: "", callbackUrl: "" });
  const [oauthSaving, setOauthSaving] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
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
      fetchOAuthConfig(),
    ])
      .then(([sessions, settings, allowedUsers, users, oauth]) => {
        setSessions(sessions);
        setRegistrationMode(settings.registrationMode);
        setSavedMode(settings.registrationMode);
        setAllowedUsers(allowedUsers);
        setUsers(users);
        setOauthConfig(oauth);
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

  async function handleKillSession(key: string) {
    const [viewer, projectId] = key.split("/");
    setError(null);
    try {
      await killSession(viewer, projectId);
      setSessions((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (e: any) {
      setError(e.message);
    }
  }

  function confirmToggleAdmin(u: AdminUser) {
    const newValue = !u.is_admin;
    setConfirmAction({
      title: newValue ? "Promote to admin" : "Remove admin",
      message: newValue
        ? `Make ${u.username} an administrator? They will be able to manage all users and settings.`
        : `Remove admin privileges from ${u.username}?`,
      confirmLabel: newValue ? "Make admin" : "Remove admin",
      async onConfirm() {
        await setUserAdmin(u.id, newValue);
        setUsers((prev) =>
          prev.map((x) => (x.id === u.id ? { ...x, is_admin: newValue } : x)),
        );
      },
    });
  }

  function confirmDeleteUser(u: AdminUser) {
    setConfirmAction({
      title: "Delete user",
      message: `Permanently delete ${u.username} and all their projects? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
      async onConfirm() {
        await deleteUser(u.id);
        setUsers((prev) => prev.filter((x) => x.id !== u.id));
        setExpandedUserId(null);
      },
    });
  }

  function handleOauthEdit() {
    setOauthForm({
      clientId: oauthConfig.clientId,
      clientSecret: "",
      callbackUrl: oauthConfig.callbackUrl,
    });
    setOauthEditing(true);
  }

  async function handleOauthSave() {
    setOauthSaving(true);
    setError(null);
    try {
      await updateOAuthConfig({
        clientId: oauthForm.clientId,
        clientSecret: oauthForm.clientSecret || undefined,
        callbackUrl: oauthForm.callbackUrl,
      });
      setOauthConfig({ clientId: oauthForm.clientId, callbackUrl: oauthForm.callbackUrl });
      setOauthEditing(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOauthSaving(false);
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
                    <button className="delete" onClick={() => handleKillSession(key)}>Kill</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>OAuth Configuration</h2>
        {oauthEditing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label>
              Client ID
              <input
                type="text"
                value={oauthForm.clientId}
                onChange={(e) => setOauthForm({ ...oauthForm, clientId: e.target.value })}
                style={{ width: "100%", marginTop: 4 }}
              />
            </label>
            <label>
              Client Secret
              <input
                type="password"
                value={oauthForm.clientSecret}
                onChange={(e) => setOauthForm({ ...oauthForm, clientSecret: e.target.value })}
                placeholder="Leave empty to keep current"
                style={{ width: "100%", marginTop: 4 }}
              />
            </label>
            <label>
              Callback URL
              <input
                type="text"
                value={oauthForm.callbackUrl}
                onChange={(e) => setOauthForm({ ...oauthForm, callbackUrl: e.target.value })}
                style={{ width: "100%", marginTop: 4 }}
              />
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button onClick={handleOauthSave} disabled={oauthSaving}>
                {oauthSaving ? "Saving..." : "Save"}
              </button>
              <button onClick={() => setOauthEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: "0.9rem", margin: "4px 0" }}>
              <strong>Client ID:</strong> {oauthConfig.clientId || <em>not configured</em>}
            </p>
            <p style={{ fontSize: "0.9rem", margin: "4px 0" }}>
              <strong>Callback URL:</strong> {oauthConfig.callbackUrl || <em>not configured</em>}
            </p>
            <button onClick={handleOauthEdit} style={{ marginTop: 8 }}>Edit</button>
          </div>
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
            {users.map((u) => {
              const isExpanded = expandedUserId === u.id;
              const isSelf = u.username === username;
              return (
                <li key={u.id} style={{ display: "block" }}>
                  <div style={{ display: "flex", alignItems: "center", cursor: "pointer" }}
                    onClick={() => setExpandedUserId(isExpanded ? null : u.id)}>
                    <span style={{ width: 16, fontSize: "0.7rem", color: "#90a4ae" }}>
                      {isExpanded ? "\u25BC" : "\u25B6"}
                    </span>
                    <div className="info" style={{ flex: 1 }}>
                      <a href={`/${u.username}/`} onClick={(e) => e.stopPropagation()}>{u.username}</a>
                      {isSelf && <span style={{ fontSize: "0.75rem", color: "#90a4ae", marginLeft: 8 }}>(you)</span>}
                    </div>
                    <span style={{ fontSize: "0.8rem", color: "#90a4ae" }}>
                      {u.is_admin ? "admin" : "user"}
                    </span>
                  </div>
                  {isExpanded && (
                    <div style={{ padding: "12px 0 4px 16px", display: "flex", gap: 8 }}>
                      <button disabled={isSelf} onClick={() => confirmToggleAdmin(u)}>
                        {u.is_admin ? "Make normal user" : "Make admin"}
                      </button>
                      <button className="delete" disabled={isSelf} onClick={() => confirmDeleteUser(u)}>
                        Delete user
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {confirmAction && (
        <ConfirmDialog action={confirmAction} onClose={() => setConfirmAction(null)} />
      )}
    </main>
  );
}
