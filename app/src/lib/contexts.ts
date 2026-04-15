'use client'

import { createContext } from 'react'

export interface Config {
  isSetupComplete: boolean
  isDevMode: boolean
  hasGithubAuth: boolean
}

/** Read-only UI configuration derived from the server configuration. */
// We set this in `RootLayout`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ConfigCtx = createContext<Config>(null as any)
