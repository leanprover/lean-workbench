import { getSeedState } from '@/lib/server/seed'

export async function GET() {
  const encoder = new TextEncoder()

  let interval: ReturnType<typeof setInterval> | undefined
  const stream = new ReadableStream({
    start(controller) {
      let cursor = 0

      interval = setInterval(() => {
        const st = getSeedState()
        while (cursor < st.events.length) {
          const event = st.events[cursor++]
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          if (event.type === 'done' || event.type === 'error') {
            clearInterval(interval)
            controller.close()
            return
          }
        }
        if (!st.inProgress) {
          clearInterval(interval)
          controller.close()
        }
      }, 500)
    },
    cancel() {
      clearInterval(interval)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
