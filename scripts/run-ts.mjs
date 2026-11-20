#!/usr/bin/node

/*
Script for staged execution of typescript files
*/

import { getElanDir } from '@leanprover/workbench-shared/node'

// Allow scripts to invoke elan and lean toolchains normally
const elanDir = getElanDir()
process.env['ELAN_HOME'] = elanDir
if (!process.env['PATH'].includes(elanDir)) process.env['PATH'] = `${elanDir}/bin:${process.env['PATH']}`

const { setup, report, steps, onExit } = await import(`./${process.argv[2]}.ts`)

try {
  await setup?.()
  for (const [i, { title, go }] of steps.entries()) {
    process.stdout.write(`[[ progress ${i + 1}/${steps.length} ${title} ]]\n`)
    await go()
  }
  await report?.()
} catch (err) {
  process.exitCode = 1
  console.error(`\nERROR:\n${err instanceof Error ? err.message : String(err)}`)
} finally {
  await onExit?.()
}
