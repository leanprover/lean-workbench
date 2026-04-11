import { getConfig, isGithubEnabled } from '$lib/server/config'
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = () => {
  const cfg = getConfig()
  return {
    isGithubEnabled: isGithubEnabled(cfg),
  }
}
