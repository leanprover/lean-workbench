import type { fetchHealth } from '../actions'

export type User = { id: string; name: string; isAdmin: boolean; createdAt: Date }
export type SessionEntry = { key: string; info: { port: number; pid: number; projectId: string }; alive: boolean }
export type HealthInfo = Awaited<ReturnType<typeof fetchHealth>>

export type ConfirmAction = {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => Promise<void>
}
