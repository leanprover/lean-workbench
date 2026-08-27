import { requireAdmin } from '@/lib/server/auth'
import { getStreamingCommandState } from '@/lib/server/stream'
import { type StreamedLogEvent } from '@/lib/util'

/**
 * Return server-sent events for a streaming command
 */
export async function GET(request: Request, context: RouteContext<'/api/admin/stream/[key]'>) {
  await requireAdmin()
  const { key } = await context.params
  const encoder = new TextEncoder()

  return new Response(
    new ReadableStream({
      start(controller) {
        const send = (msg: StreamedLogEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`))
        }

        const state = getStreamingCommandState(key)
        if (!state) {
          send({ type: 'error', message: `No '${key}' process active or finished` })
          controller.close()
          return
        }

        // Replay previous progress
        for (const line of state.log) send({ type: 'log', line })

        // Option 1: synchronously exit
        if (state.status === 'done') {
          send(state.error !== null ? { type: 'error', message: state.error } : { type: 'done' })
          controller.close()
          return
        }

        // Option 2: stream the rest of the output as it happens
        const emitter = state.emitter

        // nginx will close connections that don't send some message in 60s
        const keepAliveTimeout = setInterval(() => {
          controller.enqueue(encoder.encode(':\n'))
        }, 10_000)

        const onLog = (line: string) => {
          send({ type: 'log', line })
        }
        emitter.on('log', onLog)

        const onDone = () => {
          send({ type: 'done' })
          cleanup()
        }
        emitter.on('done', onDone)

        const onError = (message: string) => {
          send({ type: 'error', message })
          cleanup()
        }
        emitter.on('error', onError)

        const cleanup = () => {
          clearInterval(keepAliveTimeout)
          emitter.off('done', onDone)
          emitter.off('error', onError)
          emitter.off('log', onLog)
          request.signal.removeEventListener('abort', cleanup) // avoids double-calling cleanup
          controller.close()
        }
        request.signal.addEventListener('abort', cleanup, { once: true })
        if (request.signal.aborted) cleanup() // oops, the connection was closed when the function started
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    },
  )
}
