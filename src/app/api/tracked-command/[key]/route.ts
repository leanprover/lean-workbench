import { requireAuth } from '@/lib/server/auth'
import { getUserTrackedCommandState } from '@/lib/server/trackedCommand'
import { TRACKED_COMMAND_STREAMING_HEADERS, trackedCommandEventStream } from '@/lib/server/trackedCommandStream'

// Separately handle HEAD without creating a response stream
export async function HEAD() {
  await requireAuth()
  return new Response(null, { headers: TRACKED_COMMAND_STREAMING_HEADERS })
}

/** Server-sent events for a tracked command the requesting user started themselves.
 * Admin-owned commands are unreachable here, whoever is asking. */
export async function GET(request: Request, context: RouteContext<'/api/tracked-command/[key]'>) {
  const { user } = await requireAuth()
  const { key } = await context.params
  return trackedCommandEventStream(request, getUserTrackedCommandState(user, key))
}
