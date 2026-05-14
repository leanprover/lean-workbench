'use client'

import type { Viewer } from '@/app/api/projects/[projectId]/viewers/route'
import AvatarIcon from '@/app/components/AvatarIcon'
import Link from 'next/link'
import { useEffect, useState } from 'react'

export default function CollabAwareness({ viewerName, projectId }: { viewerName: string; projectId: string }) {
  const [viewers, setViewers] = useState<Viewer[]>([])

  useEffect(() => {
    const source = new EventSource(`/api/projects/${projectId}/viewers`)
    source.onmessage = event => {
      const data = JSON.parse(event.data)
      if (Array.isArray(data.viewers)) {
        setViewers(data.viewers.filter((v: Viewer) => v.name !== viewerName))
      }
    }
    return () => source.close()
  }, [projectId, viewerName])

  if (viewers.length === 0) return null
  return (
    <>
      {viewers.map(v => (
        <Link key={v.name} href={`/${v.name}`}>
          <AvatarIcon user={v} />
        </Link>
      ))}
      <div style={{ width: '2em' }} />
    </>
  )
}
