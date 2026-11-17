/*
usage: run-ts.mjs create-gitrepo WORK_DIR TEMPLATE_ID GIT_URL GIT_REV

example:
run-ts.mjs create-gitrepo /tmp/abcd new-template https://github.com/gancherj/Lait-Starter.git main

expects the following to exist:
 - $WORK_DIR/build/metadata.json
*/

import fs from 'node:fs/promises'
import path from 'node:path'

import {
  assertIsDir,
  BWRAP_ARGS,
  exe,
  existsAsync,
  getElanDir,
  getPackageSetsDir,
  getTemplatesDir,
  readJson,
  type SCRIPT_STEPS,
} from '@leanprover/workbench-shared/node'
import z from 'zod'

const [workDir, templateId, gitUrl, gitRev] = process.argv.slice(3) as [string, string, string, string]

export const setup = async () => {
  if (!gitRev) {
    throw new Error(`Not enough arguments`)
  }

  if (await existsAsync(path.join(getTemplatesDir(), templateId))) {
    throw new Error(`Template ${templateId} already exists`)
  }

  if (await existsAsync(path.join(getPackageSetsDir(), templateId))) {
    throw new Error(`Package set ${templateId} already exists`)
  }

  await fs.mkdir(homeDir, { recursive: true })
}

export const onExit = async () => {
  await fs.rm(workDir, { recursive: true, force: true })
}

const repoDir = path.join(workDir, 'repo')
const packageSetDir = path.join(workDir, 'package-set')
const templateDir = path.join(workDir, 'template')
const buildDir = path.join(workDir, 'build')
const homeDir = path.join(workDir, 'home')

let toolchain: string
let hasPackages: boolean
let numPackages = 0
export const steps: SCRIPT_STEPS = [
  {
    title: 'Checking out project',
    go() {
      exe('git', ['clone', '--', gitUrl, repoDir])
      process.chdir(repoDir)
      exe('git', ['checkout', gitRev])
      exe('git', ['submodule', 'update', '--init', '--recursive'])
    },
  },
  {
    title: 'Checking toolchain',
    async go() {
      try {
        toolchain = (
          await fs.readFile(path.join(repoDir, 'lean-toolchain'), { encoding: 'utf-8', flag: fs.constants.O_NOFOLLOW })
        ).trim()
      } catch {
        throw new Error(`Could not read 'lean-toolchain' in the project's root`)
      }
      const availableToolchains = exe('elan', ['toolchain', 'list'], { captureStdout: true }).split('\n')
      if (!availableToolchains.includes(toolchain)) throw new Error(`Toolchain used by this project is not installed`)
    },
  },
  {
    title: 'Acquiring project dependencies',
    async go() {
      if (!(await existsAsync('lake-manifest.json'))) {
        bwrap('lake', '--keep-toolchain', '--no-ansi', 'update')
      }
      try {
        bwrap('lake', '--no-ansi', 'exe', '@mathlib/cache', 'get')
      } catch {
        console.log('Mathlib cache unavailable (or not a Mathlib-using project)')
      }
    },
  },
  {
    title: 'Building project (default target)',
    async go() {
      bwrap('lake', '--no-ansi', 'build')

      // If the package made .lake or .lake/packages a symlink, it could interfere with package construction
      await assertIsDir(path.join(repoDir, '.lake'))
      await assertIsDir(path.join(repoDir, '.lake', 'packages'))
    },
  },
  {
    title: 'Constructing package set',
    async go() {
      hasPackages = await existsAsync(path.join(repoDir, '.lake', 'packages'))
      if (hasPackages) {
        await fs.mkdir(packageSetDir)
        const packages = await fs.readdir(path.join(repoDir, '.lake', 'packages'))
        numPackages = packages.length
        for (const pkgName of packages) {
          console.log(`[package set] copying package: ${pkgName}`)
          const pkgDest = path.join(packageSetDir, pkgName, '.lake', 'packages')
          await fs.mkdir(pkgDest, { recursive: true })
          await fs.rename(path.join(repoDir, '.lake', 'packages', pkgName), path.join(pkgDest, pkgName))
        }
        await fs.writeFile(path.join(packageSetDir, 'packages.txt'), packages.join('\n'))
      } else {
        console.log('skipped: no package set for package')
      }
    },
  },
  {
    title: 'Constructing template',
    async go() {
      await fs.mkdir(templateDir)
      exe('rsync', [
        '-a',
        '--exclude=.git',
        '--exclude=.github',
        '--exclude=.lake',
        '--exclude=/metadata.json',
        `${repoDir}/`,
        `${templateDir}/`,
      ])

      const metadata = await readJson(path.join(buildDir, 'metadata.json'), z.object({ name: z.string() }))
      if (!metadata.success)
        throw new Error(metadata.error instanceof Error ? metadata.error.message : String(metadata.error))
      await fs.writeFile(
        path.join(templateDir, 'metadata.json'),
        JSON.stringify({
          name: metadata.data.name,
          packageSet: hasPackages ? templateId : undefined,
        }),
      )
    },
  },
  {
    title: 'Placing package set and template',
    async go() {
      // Technically possible for the first rename to succeed and second to fail;
      // the package set placement won't be rolled back if this happens.
      if (hasPackages) await fs.rename(packageSetDir, path.join(getPackageSetsDir(), templateId))
      await fs.rename(templateDir, path.join(getTemplatesDir(), templateId))
    },
  },
]

export const report = async () => {
  console.log('')
  console.log('[create-template] Done.')
  console.log(`  Template:     ${path.join(getTemplatesDir(), templateId)}`)
  if (hasPackages) {
    const packageSetPlaced = path.join(getPackageSetsDir(), templateId)
    console.log(`  Package set:  ${packageSetPlaced}`)
    console.log(`  Packages:     ${numPackages}`)
    const numOleans = exe('find', [packageSetPlaced, '-name', '*.olean'], { captureStdout: true })
      .split('\n')
      .filter(s => s.trim()).length
    console.log(`  .olean files: ${numOleans}`)
    const totalSize = exe('du', ['-sh', packageSetPlaced], { captureStdout: true }).match(/[^\s]+/)?.[0]
    console.log(`  Total size:   ${totalSize}`)
  }
}

const elanDir = getElanDir()
function bwrap(...cmd: string[]) {
  exe(
    'bwrap',
    // prettier-ignore
    [
      ...BWRAP_ARGS,
      '--ro-bind', elanDir, elanDir,
      '--bind', repoDir, '/repo',
      // Lake needs a home dir for .cache
      '--bind', homeDir, '/home/build',
      '--setenv', 'HOME', '/home/build',
      '--setenv', 'ELAN_HOME', elanDir,
      '--setenv', 'MATHLIB_NO_CACHE_ON_UPDATE', '1',
      '--setenv', 'PATH', `${elanDir}/bin:/usr/local/bin:/usr/bin:/bin`,
      '--chdir', '/repo',
      '--', ...cmd
    ],
  )
}
