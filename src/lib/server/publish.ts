import 'server-only'

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { bwrapProjectDir } from '@leanprover/workbench-shared'
import {
  existsAsync,
  getElanDir,
  getPublicationDir,
  getPublicationsDir,
  getPublishStagingDir,
  getScriptsDir,
  getUserHomeDir,
} from '@leanprover/workbench-shared/node'

import { type User } from '@/lib/server/auth'
import { getConfig } from '@/lib/server/config'
import { getDb } from '@/lib/server/db'
import { getEditorSessionManager } from '@/lib/server/editorSessions'
import {
  countRunningTrackedCommands,
  getUserTrackedCommandState,
  startTrackedCommand,
} from '@/lib/server/trackedCommand'
import { BWRAP_ARGS, bwrapHomeDir } from '@/lib/server/util'
import { type ActionResponse, type TrackedCommandExit } from '@/lib/util'
import { type Prisma, type Project } from '@/prisma/generated/client'

import { type BuildPlan } from './artifacts'

/** Lean builds are CPU- and memory-hungry,
 * so only this many publish builds may be in flight across the whole server. */
const MAX_CONCURRENT_PUBLISH_BUILDS = 2

const PUBLISH_KEY_PREFIX = 'publish-'

/** Tracking key of a project's build of one artifact kind.
 * One build at a time per project and kind falls out of
 * `startTrackedCommand` refusing a key that is already running. */
export function publishTrackingKey(projectId: string, kind: string): string {
  return `${PUBLISH_KEY_PREFIX}${projectId}-${kind}`
}

/** First segment of a publication's durable URL.
    TODO(#132): ensure there is no user named "pub" */
export const PUB_DURABLE_PREFIX = 'pub'

/** The URL a publication is linked by: it names whichever publication is current
 * for this project and kind, and follows the project if it is renamed. */
export function publicationUrl(ownerName: string, projectName: string, kind: string): string {
  return `${getConfig().pubBaseUrl}/${ownerName}/${projectName}/${kind}/`
}

/** The URL that names one publication for good.
 * It survives a user or project rename. */
export function durablePublicationUrl(publicationId: string): string {
  return `${getConfig().pubBaseUrl}/${PUB_DURABLE_PREFIX}/${publicationId}/`
}

/** Where the sandbox sees the workbench's scripts. */
const SANDBOX_SCRIPTS_DIR = '/publish/scripts'
/** Where the sandbox sees the staging directory that the build writes into. */
const SANDBOX_OUT_DIR = '/publish/out'

/** Start a sandboxed build of one of `project`'s publishable artifacts,
 * streaming its output to `owner` under {@link publishTrackingKey}.
 *
 * Resolves once the build has been started, not when it finishes:
 * the output is swapped into place by an `exit` listener,
 * so publishing completes whether or not a browser is still watching. */
export async function startPublish(
  owner: User,
  project: Project,
  kind: string,
  plan: BuildPlan,
): Promise<ActionResponse<boolean>> {
  if (countRunningTrackedCommands(key => key.startsWith(PUBLISH_KEY_PREFIX)) >= MAX_CONCURRENT_PUBLISH_BUILDS) {
    return {
      error:
        'The server has reached the limit of how many publication builds can be active at the same time. ' +
        'Try again later.',
    }
  }

  const trackingKey = publishTrackingKey(project.id, kind)
  // `startTrackedCommand` below is what actually claims the key.
  // Checking first only avoids building an overlay mount we would immediately tear down.
  if (getUserTrackedCommandState(owner, trackingKey)?.status === 'running') return { ok: false }

  // What this build is allowed to replace. A build only ever updates the publication
  // that existed when it started: if that row is gone by the time it finishes, the owner
  // unpublished, and the output is discarded rather than reappearing under a fresh id.
  const startedFrom = (
    await getDb().publication.findUnique({ where: { projectId_kind: { projectId: project.id, kind } } })
  )?.id

  await using stack = new AsyncDisposableStack()

  // Created but never emptied here: a build that is already running owns its staging directory.
  // The script clears it, and `finishPublish` removes it once the build exits.
  const stagingDir = getPublishStagingDir(project.id, kind)
  await fs.mkdir(stagingDir, { recursive: true })

  // Must be the shared mount: a second overlay on the same upper layer would corrupt the project.
  const mount = stack.use(await getEditorSessionManager().acquireProjectMount(owner, project))

  const homeDir = getUserHomeDir(owner)
  const elanDir = getElanDir()
  const sandboxHomeDir = bwrapHomeDir(owner.name)

  const emitter = startTrackedCommand(
    trackingKey,
    { kind: 'user', userId: owner.id },
    'bwrap',
    // prettier-ignore
    [
      ...BWRAP_ARGS,
      '--ro-bind', elanDir, elanDir,
      '--ro-bind', getScriptsDir(), SANDBOX_SCRIPTS_DIR,
      // `lake` needs a writable home for its caches.
      '--bind', homeDir, sandboxHomeDir,
      '--bind', stagingDir, SANDBOX_OUT_DIR,
      '--setenv', 'HOME', sandboxHomeDir,
      '--setenv', 'ELAN_HOME', elanDir,
      '--setenv', 'PATH', `${elanDir}/bin:/usr/local/bin:/usr/bin:/bin`,
      // The overlay mount makes `lake`'s dependency clones look dubiously owned to Git
      // (CVE-2022-24765); see the same workaround in `VscodeServerHandle.start`.
      '--setenv', 'GIT_CONFIG_COUNT', '1',
      '--setenv', 'GIT_CONFIG_KEY_0', 'safe.directory',
      '--setenv', 'GIT_CONFIG_VALUE_0', '*',
      ...mount.value.bindArgs,
      '--chdir', bwrapProjectDir(project.name),
      '--',
      path.join(SANDBOX_SCRIPTS_DIR, plan.script), SANDBOX_OUT_DIR, ...plan.args,
    ],
  )
  if (!emitter) return { ok: false }

  emitter.on('exit', exit => {
    void (async () => {
      try {
        try {
          await finishPublish(project, kind, plan, exit, startedFrom)
        } finally {
          await mount[Symbol.asyncDispose]()
        }
      } catch (e: unknown) {
        console.error(`[publish] ${project.id}/${kind} did not complete: ${String(e)}`)
      }
    })()
  })

  // The build owns the mount lease from here on.
  stack.move()
  return { ok: true }
}

/** Swap a finished build's output into place, or discard it.
 *
 * A failed build leaves any existing publication exactly as it was.
 * So does one whose publication went away while it ran:
 * {@link startedFrom} is the row the build set out to replace,
 * and a build that no longer has one has been overtaken by the owner.
 *
 * The URL 404s briefly while the directories are exchanged;
 * avoiding that would mean a database lookup in front of every static asset. */
async function finishPublish(
  project: Project,
  kind: string,
  plan: BuildPlan,
  exit: TrackedCommandExit,
  startedFrom: string | undefined,
) {
  const stagingDir = getPublishStagingDir(project.id, kind)
  try {
    if (exit.type !== 'success') return

    const siteDir = path.join(stagingDir, plan.siteDir)
    if (!(await existsAsync(siteDir))) {
      throw new Error(`the build wrote no '${plan.siteDir}' directory, so it produced no site`)
    }

    const db = getDb()
    const where = { projectId_kind: { projectId: project.id, kind } }
    const current = (await db.publication.findUnique({ where }))?.id
    if (startedFrom !== undefined && current !== startedFrom) return

    const id = current ?? crypto.randomUUID()

    // Before moving anything: if the project has been deleted, the foreign key fails here,
    // while the output is still in staging for the `finally` below to remove.
    await db.publication.upsert({
      where,
      create: { id, projectId: project.id, kind },
      update: { updatedAt: new Date() },
    })

    const liveDir = getPublicationDir(id)
    const replacedDir = path.join(getPublicationsDir(), `.replaced-${id}`)

    await fs.rm(replacedDir, { recursive: true, force: true })
    if (await existsAsync(liveDir)) await fs.rename(liveDir, replacedDir)
    await fs.rename(siteDir, liveDir)
    await fs.rm(replacedDir, { recursive: true, force: true })
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true })
  }
}

/** Take the matching publications out of service and remove their files.
 *
 * Rows go first: a publication is live exactly while its row exists,
 * so an interruption here leaves unreferenced directories
 * rather than rows pointing at files that are gone. */
export async function deletePublications(where: Prisma.PublicationWhereInput): Promise<void> {
  const db = getDb()
  const publications = await db.publication.findMany({ where })
  await db.publication.deleteMany({ where })
  await Promise.all(publications.map(p => fs.rm(getPublicationDir(p.id), { recursive: true, force: true })))
}
