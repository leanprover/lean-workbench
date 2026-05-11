export type ActionResponse<T = void> = { ok: T } | { error: string }

export const LEAN_VERSION_RE = /^v4\.\d+\.\d+(-rc\d+)?$/
