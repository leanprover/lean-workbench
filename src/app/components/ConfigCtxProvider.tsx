import { io } from 'next/cache'
import { type ReactNode } from 'react'

import { ConfigCtx } from '@/lib/contexts'
import { getConfig, hasGithubAuth, isDevMode } from '@/lib/server/config'

export async function ConfigCtxProvider({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  // NOTE: We want to await `io` before we read server state;
  // that causes this component to suspend and prevents the children from being pre-rendered
  await io()

  const serverCfg = getConfig()
  const clientCfg = {
    isSetupComplete: serverCfg.isSetupComplete,
    isDevMode: isDevMode(),
    hasGithubAuth: hasGithubAuth(serverCfg),
    registrationMode: serverCfg.registrationMode,
  }

  // This is the pattern for including potentially-server components (the children)
  // inside of a client component (a React Context like ConfigCtx must be a client component)
  // https://nextjs.org/docs/app/getting-started/server-and-client-components#interleaving-server-and-client-components
  return <ConfigCtx value={clientCfg}>{children}</ConfigCtx>
}
