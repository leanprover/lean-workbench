'use client'

import { createContext } from 'react'

import type { RegistrationMode } from '@/lib/server/config'

export interface Config {
  isSetupComplete: boolean
  isDevMode: boolean
  hasGithubAuth: boolean
  registrationMode: RegistrationMode
}

/** Read-only UI configuration derived from the server configuration. */
// We set this in `RootLayout`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ConfigCtx = createContext<Config>(null as any)
