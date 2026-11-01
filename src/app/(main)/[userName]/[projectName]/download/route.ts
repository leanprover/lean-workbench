import { spawn } from 'node:child_process'

import { zProjectName, zUserName } from '@leanprover/workbench-shared'
import { getProjectDir, iteratorToStream } from '@leanprover/workbench-shared/node'
import { notFound } from 'next/navigation'
import z from 'zod'

import { requireAuth } from '@/lib/server/auth'
import { getProjectForViewer } from '@/lib/server/util'

const zParams = z.object({
  userName: zUserName,
  projectName: zProjectName,
})

async function* generateProjectTgz(owner: { id: string }, projectId: string): AsyncGenerator<Uint8Array, void> {
  const tar = spawn('tar', ['-czf', '-', '--exclude=./.lake', '.'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    cwd: getProjectDir(owner, projectId),
  })
  const closed = new Promise(resolve => tar.on('close', resolve))
  try {
    yield* tar.stdout
    const code = await closed
    if (code !== 0) throw new Error(`tar of project ${owner.id}/${projectId} exited with ${code}`)
  } finally {
    tar.kill()
  }
}

export async function GET(_req: Request, { params }: { params: Promise<unknown> }) {
  const parsed = zParams.safeParse(await params)
  if (!parsed.success) return new Response(parsed.error.issues[0]!.message, { status: 400 })
  const { userName, projectName } = parsed.data

  const session = await requireAuth()

  const proj = await getProjectForViewer(session.user, userName, projectName)
  if (!proj) notFound() // 404 rather than 403 to avoid leaking the existence of inaccessible projects.
  const { owner, project } = proj

  return new Response(iteratorToStream(generateProjectTgz(owner, project.id)), {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${project.name}.tgz"`,
    },
  })
}
