import { requireAdmin } from '@/app/admin/actions'
import { getSeedState } from '@/lib/server/seed'
import { sseStreamResponse } from '@/lib/server/util'

export async function GET() {
  await requireAdmin()

  // eslint-disable-next-line prefer-const
  let interval: ReturnType<typeof setInterval> | undefined
  const [response, send, close] = sseStreamResponse(() => {
    clearInterval(interval)
  })
  let cursor = 0
  interval = setInterval(() => {
    const st = getSeedState()
    while (cursor < st.events.length) {
      const event = st.events[cursor++]!
      send(event)
      if (event.type === 'done' || event.type === 'error') {
        clearInterval(interval)
        close()
        return
      }
    }
    if (!st.inProgress) {
      clearInterval(interval)
      close()
    }
  }, 500)

  return response
}
