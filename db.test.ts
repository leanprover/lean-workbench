import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  initDb, closeDb,
  ensureUser, getUserById, getUserByUsername, getUserCount,
  upsertGithubUser, getAvatarUrl,
  isAdmin, setAdmin, getAllUsers, deleteUser,
  createProject, getProjectsByUser, getProjectByUserAndName, getProjectById,
  updateProject, deleteProject, PROJECT_NAME_RE,
  setProjectPublic, getPublicProjectsByUsername, getProjectByOwnerUsernameAndName,
  getPackageSets, addPackageSet,
  getSetting, setSetting,
  getAllowedUsers, addAllowedUser, removeAllowedUser, isUserAllowed,
  isFirstRunComplete, setFirstRunComplete,
  getAuthMethod, saveAuthMethod,
} from "./db.ts";

beforeEach(() => {
  initDb(":memory:");
});

afterEach(() => {
  closeDb();
});

// --- Users ---

describe("ensureUser", () => {
  it("creates a new user", () => {
    const user = ensureUser("alice");
    expect(user.username).toBe("alice");
    expect(user.id).toBeGreaterThan(0);
  });

  it("returns existing user on second call", () => {
    const a = ensureUser("alice");
    const b = ensureUser("alice");
    expect(a.id).toBe(b.id);
  });
});

describe("getUserById / getUserByUsername", () => {
  it("round-trips", () => {
    const user = ensureUser("bob");
    expect(getUserById(user.id)?.username).toBe("bob");
    expect(getUserByUsername("bob")?.id).toBe(user.id);
  });

  it("returns undefined for missing user", () => {
    expect(getUserById(9999)).toBeUndefined();
    expect(getUserByUsername("nobody")).toBeUndefined();
  });
});

describe("getUserCount", () => {
  it("counts users", () => {
    expect(getUserCount()).toBe(0);
    ensureUser("a");
    ensureUser("b");
    expect(getUserCount()).toBe(2);
  });
});

// --- GitHub upsert ---

describe("upsertGithubUser", () => {
  it("creates user and auth_github row", () => {
    const user = upsertGithubUser({
      github_id: 100,
      github_username: "Alice",
      display_name: "Alice A",
      email: "alice@example.com",
      avatar_url: "https://example.com/alice.png",
    });
    expect(user.username).toBe("alice"); // lowercased
    expect(getAvatarUrl(user.id)).toBe("https://example.com/alice.png");
  });

  it("updates on second call with same github_id", () => {
    const first = upsertGithubUser({
      github_id: 200,
      github_username: "Bob",
    });
    const second = upsertGithubUser({
      github_id: 200,
      github_username: "Bob",
      avatar_url: "https://example.com/bob.png",
    });
    expect(second.id).toBe(first.id);
    expect(getAvatarUrl(second.id)).toBe("https://example.com/bob.png");
  });
});

// --- Admin ---

describe("admin", () => {
  it("setAdmin / isAdmin", () => {
    const user = ensureUser("admin-test");
    expect(isAdmin(user.id)).toBe(false);
    setAdmin(user.id, true);
    expect(isAdmin(user.id)).toBe(true);
    setAdmin(user.id, false);
    expect(isAdmin(user.id)).toBe(false);
  });

  it("is_admin flag appears in getUserById", () => {
    const user = ensureUser("x");
    setAdmin(user.id, true);
    expect(getUserById(user.id)?.is_admin).toBe(true);
  });

  it("getAllUsers includes admin flag", () => {
    const a = ensureUser("a");
    ensureUser("b");
    setAdmin(a.id, true);
    const all = getAllUsers();
    expect(all.find(u => u.username === "a")?.is_admin).toBe(true);
    expect(all.find(u => u.username === "b")?.is_admin).toBe(false);
  });
});

describe("deleteUser", () => {
  it("removes the user", () => {
    const user = ensureUser("gone");
    deleteUser(user.id);
    expect(getUserById(user.id)).toBeUndefined();
  });
});

// --- Projects ---

describe("projects", () => {
  it("CRUD lifecycle", () => {
    const user = ensureUser("dev");
    const proj = createProject(user.id, "my-proj", "blank");
    expect(proj.name).toBe("my-proj");
    expect(proj.template).toBe("blank");
    expect(proj.user_id).toBe(user.id);

    expect(getProjectById(proj.id)?.name).toBe("my-proj");
    expect(getProjectByUserAndName(user.id, "my-proj")?.id).toBe(proj.id);
    expect(getProjectsByUser(user.id)).toHaveLength(1);

    updateProject(proj.id, "renamed");
    expect(getProjectById(proj.id)?.name).toBe("renamed");

    deleteProject(proj.id);
    expect(getProjectById(proj.id)).toBeUndefined();
    expect(getProjectsByUser(user.id)).toHaveLength(0);
  });

  it("enforces unique (user_id, name)", () => {
    const user = ensureUser("dev");
    createProject(user.id, "dup", "blank");
    expect(() => createProject(user.id, "dup", "blank")).toThrow();
  });
});

describe("PROJECT_NAME_RE", () => {
  it("accepts valid names", () => {
    expect(PROJECT_NAME_RE.test("hello")).toBe(true);
    expect(PROJECT_NAME_RE.test("my-project")).toBe(true);
    expect(PROJECT_NAME_RE.test("test_123")).toBe(true);
  });

  it("rejects invalid names", () => {
    expect(PROJECT_NAME_RE.test("")).toBe(false);
    expect(PROJECT_NAME_RE.test("-starts-with-dash")).toBe(false);
    expect(PROJECT_NAME_RE.test("has spaces")).toBe(false);
  });
});

describe("project visibility", () => {
  it("setProjectPublic / getPublicProjectsByUsername", () => {
    const user = ensureUser("vis");
    const p1 = createProject(user.id, "public-proj", "blank");
    const p2 = createProject(user.id, "private-proj", "blank");
    setProjectPublic(p1.id, true);

    const pub = getPublicProjectsByUsername("vis");
    expect(pub).toHaveLength(1);
    expect(pub[0].id).toBe(p1.id);
  });

  it("getProjectByOwnerUsernameAndName", () => {
    const user = ensureUser("owner");
    const proj = createProject(user.id, "findme", "blank");
    expect(getProjectByOwnerUsernameAndName("owner", "findme")?.id).toBe(proj.id);
    expect(getProjectByOwnerUsernameAndName("owner", "nope")).toBeUndefined();
  });
});

// --- Package sets ---

describe("package sets", () => {
  it("add and retrieve", () => {
    const user = ensureUser("dev");
    const proj = createProject(user.id, "pkg-test", "blank");
    expect(getPackageSets(proj.id)).toEqual([]);

    addPackageSet(proj.id, "mathlib-v4.0.0");
    addPackageSet(proj.id, "mathlib-v4.0.0"); // duplicate is ignored
    expect(getPackageSets(proj.id)).toEqual(["mathlib-v4.0.0"]);

    addPackageSet(proj.id, "another-set");
    expect(getPackageSets(proj.id)).toHaveLength(2);
  });
});

// --- Settings ---

describe("settings", () => {
  it("getSetting / setSetting", () => {
    // registration_mode has a default from schema
    expect(getSetting("registration_mode")).toBe("open");

    setSetting("registration_mode", "restricted");
    expect(getSetting("registration_mode")).toBe("restricted");

    expect(getSetting("nonexistent")).toBeNull();
  });
});

// --- Allowed users ---

describe("allowed users", () => {
  it("add / remove / list", () => {
    expect(getAllowedUsers()).toEqual([]);
    addAllowedUser("Alice");
    addAllowedUser("Bob");
    expect(getAllowedUsers()).toEqual(["alice", "bob"]);
    removeAllowedUser("Alice");
    expect(getAllowedUsers()).toEqual(["bob"]);
  });

  it("isUserAllowed respects registration_mode", () => {
    expect(isUserAllowed("anyone")).toBe(true); // open mode

    setSetting("registration_mode", "restricted");
    expect(isUserAllowed("stranger")).toBe(false);
    addAllowedUser("friend");
    expect(isUserAllowed("friend")).toBe(true);
  });
});

// --- First run ---

describe("first run", () => {
  it("starts incomplete, can be completed", () => {
    expect(isFirstRunComplete()).toBe(false);
    setFirstRunComplete();
    expect(isFirstRunComplete()).toBe(true);
  });
});

// --- Auth methods ---

describe("auth methods", () => {
  it("save and retrieve", () => {
    expect(getAuthMethod("github_oauth")).toBeNull();
    saveAuthMethod("github_oauth", { clientId: "abc", clientSecret: "xyz" });
    const config = getAuthMethod("github_oauth") as any;
    expect(config.clientId).toBe("abc");
  });

  it("upserts on conflict", () => {
    saveAuthMethod("session", { secret: "old" });
    saveAuthMethod("session", { secret: "new" });
    const config = getAuthMethod("session") as any;
    expect(config.secret).toBe("new");
  });
});
