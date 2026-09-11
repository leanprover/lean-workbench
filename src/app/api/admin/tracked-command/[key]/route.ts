import { requireAdmin } from '@/lib/server/auth'
import { getTrackedCommandState } from '@/lib/server/trackedCommand'
import { TRACKED_COMMAND_STREAMING_HEADERS, trackedCommandEventStream } from '@/lib/server/trackedCommandStream'

// Separately handle HEAD without creating a response stream
export async function HEAD() {
  await requireAdmin()
  return new Response(null, { headers: TRACKED_COMMAND_STREAMING_HEADERS })
}

/** Server-sent events for any tracked command, for administrators.
 * These commands run unsandboxed as the server user,
 * so their output is not shown to anybody else. */
export async function GET(request: Request, context: RouteContext<'/api/admin/tracked-command/[key]'>) {
  await requireAdmin()
  const { key } = await context.params
  return trackedCommandEventStream(request, getTrackedCommandState(key))
}
