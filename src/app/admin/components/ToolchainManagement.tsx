'use client'

import {
  EXPECTED_TOOLCHAIN_ID_RE,
  LEAN_BETA_VERSION_RE,
  LEAN_NIGHTLY_VERSION_RE,
  LEAN_STABLE_VERSION_RE,
} from '@leanprover/workbench-shared'
import { useRouter } from 'next/navigation'
import { use, useState } from 'react'
import z from 'zod'

import { doElanInstall, uninstallToolchainVersion } from '@/app/admin/actions'
import CatchySuspense from '@/app/components/CatchySuspense'
import TrackedCommandForm from '@/app/components/TrackedCommandForm'
import { useServerAction, useThrowingSWR } from '@/lib/client/util'

interface ToolchainManagementProps {
  installedToolchainsPromise: Promise<string[]>
}

export function ToolchainManagement(props: ToolchainManagementProps) {
  const router = useRouter()
  return (
    <section>
      <h2>Lean Toolchains</h2>
      <CatchySuspense loading={<p>Loading installed toolchains&hellip;</p>}>
        <ToolchainManagementList {...props} />
      </CatchySuspense>
      <TrackedCommandForm
        streamCommandKey='elan'
        trackedCommandAction={doElanInstall}
        title='+ New Toolchain'
        successAction={() => router.refresh()}
      >
        <CatchySuspense loading={<p>Loading available toolchains&hellip;</p>}>
          <NewToolchainForm />
        </CatchySuspense>
      </TrackedCommandForm>
    </section>
  )
}

function ToolchainManagementList(props: ToolchainManagementProps) {
  const installedToolchains = use(props.installedToolchainsPromise)
  if (installedToolchains.length === 0) return <p className='empty'>No installed toolchains.</p>
  return (
    <ul className='project-list'>
      {installedToolchains.map(toolchain => (
        <ToolchainRow key={toolchain} toolchain={toolchain} />
      ))}
    </ul>
  )
}

function ToolchainRow(props: { toolchain: string }) {
  const router = useRouter()
  const [confirm, setConfirm] = useState(false)
  const [error, action, pending] = useServerAction(uninstallToolchainVersion, () => {
    router.refresh()
  })
  return (
    <li>
      <form className='simple-action-form' action={action}>
        <div style={{ gridArea: 'name' }}>{props.toolchain}</div>
        <input type='hidden' name='toolchain' value={props.toolchain} />
        {EXPECTED_TOOLCHAIN_ID_RE.test(props.toolchain) /* prevent uninstall of weird-enough-named toolchains */ && (
          <div className='actions' style={{ gridArea: 'actions' }}>
            {!confirm && (
              <button type='button' onClick={() => setConfirm(true)}>
                Remove Toolchain
              </button>
            )}
            {confirm && (
              <>
                <button className='delete' disabled={pending} type='submit'>
                  Confirm Removing Toolchain
                </button>
                <button disabled={pending} type='button' onClick={() => setConfirm(false)}>
                  Cancel
                </button>
              </>
            )}
          </div>
        )}
        <div style={{ gridArea: 'error', color: '#f00' }}>{error}</div>
      </form>
    </li>
  )
}

const zLeanRelease = z.object({ name: z.string(), created_at: z.iso.datetime() })
const zLeanReleases = z.object({
  version: z.literal('1'),
  stable: z.array(zLeanRelease.transform(tc => ({ type: 'stable' as const, ...tc }))),
  beta: z.array(zLeanRelease.transform(tc => ({ type: 'beta' as const, ...tc }))),
  nightly: z.array(zLeanRelease.transform(tc => ({ type: 'nightly' as const, ...tc }))),
})

function NewToolchainForm() {
  const { data: toolchainsAvailable } = useThrowingSWR(
    'release.llo',
    async () => {
      const res = await fetch('https://release.lean-lang.org')
      if (!res.ok) throw new Error(`release.lean-lang.org returned error (${res.status})`)
      return zLeanReleases.parse(await res.json())
    },
    { suspense: true, revalidateIfStale: false, revalidateOnFocus: false, revalidateOnReconnect: false },
  )

  const [stable, setStable] = useState(true)
  const [beta, setBeta] = useState(true)
  const [nightly, setNightly] = useState(false)
  const count = (stable ? 1 : 0) + (beta ? 1 : 0) + (nightly ? 1 : 0)

  const all = [
    stable ? toolchainsAvailable.stable.filter(tc => LEAN_STABLE_VERSION_RE.test(tc.name)) : [],
    beta ? toolchainsAvailable.beta.filter(tc => LEAN_BETA_VERSION_RE.test(tc.name)) : [],
    nightly ? toolchainsAvailable.nightly.filter(tc => LEAN_NIGHTLY_VERSION_RE.test(tc.name)) : [],
  ]
    .flat()
    .toSorted((a, b) => (a.created_at > b.created_at ? -1 : a.created_at < b.created_at ? 1 : 0))

  return (
    <>
      <div className='check-seq'>
        <label>
          <input
            id='tc-stable'
            type='checkbox'
            checked={stable}
            disabled={stable && count === 1}
            onChange={() => setStable(s => !s)}
          />
          Stable
        </label>
        <label>
          <input
            id='tc-beta'
            type='checkbox'
            checked={beta}
            disabled={beta && count === 1}
            onChange={() => setBeta(s => !s)}
          />
          Beta
        </label>
        <label>
          <input
            id='tc-nightly'
            type='checkbox'
            checked={nightly}
            disabled={nightly && count === 1}
            onChange={() => setNightly(s => !s)}
          />
          Nightly
        </label>
      </div>
      <select name='selectedToolchain' defaultValue={`stable ${toolchainsAvailable.stable[0]?.name}`}>
        {all.map(({ type, name }) => (
          <option key={`${type} ${name}`} value={`${type} ${name}`}>
            {name}
          </option>
        ))}
      </select>
    </>
  )
}
