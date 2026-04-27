import fs from 'node:fs'
import 'server-only'

export interface ProcessInfo {
  pid: number
  /** Parent PID. */
  ppid: number
  cmdline: string[]
  children: ProcessInfo[]
}

/** Read the process table from `/proc`,
 * returning a map from PID to process info with children linked.
 * Linux-only. */
export function readProcesses(): Map<number, ProcessInfo> {
  const procs = new Map<number, ProcessInfo>()
  for (const entry of fs.readdirSync('/proc')) {
    const pid = Number(entry)
    if (!Number.isInteger(pid)) continue
    try {
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf-8')
      const ppid = Number(status.match(/^PPid:\s*(\d+)/m)![1])
      const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf-8').split('\0')
      procs.set(pid, { pid, ppid, cmdline, children: [] })
    } catch {}
  }
  for (const proc of procs.values()) {
    procs.get(proc.ppid)?.children.push(proc)
  }
  return procs
}
