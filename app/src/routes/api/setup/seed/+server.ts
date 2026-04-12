import { startSeeding } from '$lib/server/seedVolume'
import { error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = () => {
  try {
    startSeeding()
  } catch (e) {
    error(400, (e as Error).message)
  }
  return new Response(null, { status: 204 })
}
