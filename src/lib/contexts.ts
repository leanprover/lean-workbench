'use client'

import { createContext, useContext } from 'react'

import type { RegistrationMode } from '@/lib/server/config'

export interface Config {
  isSetupComplete: boolean
  isDevMode: boolean
  hasGithubAuth: boolean
  registrationMode: RegistrationMode
}

/** Read-only UI configuration derived from the server configuration, set in RootLayout */
export const ConfigCtx = createContext<Config | null>(null)

export function useConfigCtx() {
  const cfg = useContext(ConfigCtx)
  if (!cfg) throw new Error('useConfigCtx called outside of a ConfigCtx')
  return cfg
}
