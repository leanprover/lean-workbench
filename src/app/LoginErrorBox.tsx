'use client'

import { useSearchParams } from 'next/navigation'

import { ErrorBox } from '@/app/components/ErrorBox'
import { type Config, useConfigCtx } from '@/lib/contexts'

/**
 * Interprets an (untrusted) `error` search parameter as OAuth callback information
 */
function errorParamToMsg(e: string, cfg: Config): string {
  switch (e) {
    case 'unable_to_create_user': {
      let msg = 'Could not sign up.'
      if (cfg.registrationMode === 'restricted') {
        msg += ' Ask your administrator to allow you to register.'
      }
      return msg
    }
    case 'invalid_code': {
      return 'Invalid GitHub OAuth configuration. Ask your administrator to fix it.'
    }
    case 'access_denied': {
      return 'GitHub sign-in was cancelled.'
    }
    case 'account_not_linked': {
      return 'The email associated with this GitHub account is already being used by a different account.'
    }
    default: {
      // An unrecognized search parameter should not be shown directly to the user (phishing risk)
      return 'Unexpected sign-in failure. Please try again; contact your administrator if this error continues.'
    }
  }
}

export function LoginErrorBox() {
  const cfg = useConfigCtx()
  const error = useSearchParams().get('error')
  return error && <ErrorBox>Error logging in: {errorParamToMsg(error, cfg)}</ErrorBox>
}
