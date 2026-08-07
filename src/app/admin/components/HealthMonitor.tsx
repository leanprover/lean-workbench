'use client'

import { startTransition, useState } from 'react'
import useSWR from 'swr'

import { fetchDiskUsage, fetchHealth, type SystemHealth } from '@/app/admin/actions'
import { useServerAction } from '@/lib/client/util'

import { formatBytes, formatUptime } from './utils'

const labelStyle = { padding: '4px 12px 4px 0', color: '#666' }
const valueStyle = { padding: '4px 0' }

export function HealthMonitor() {
  const { data: health, error: healthError } = useSWR<SystemHealth, Error>('adminHealth', () => fetchHealth(), {
    refreshInterval: 30_000,
  })
  const [workspacesSize, setWorkspacesSize] = useState<string | null>(null)
  const [duError, duAction, duPending] = useServerAction(
    () => fetchDiskUsage(),
    ({ workspaces }) => setWorkspacesSize(workspaces),
  )

  if (healthError) {
    return (
      <section>
        <h2>System health</h2>
        <p style={{ color: '#dc2626' }}>Failed to load: {String(healthError)}</p>
      </section>
    )
  }
  if (!health) {
    return (
      <section>
        <h2>System health</h2>
        <p>Loading...</p>
      </section>
    )
  }

  return (
    <section>
      <h2>System health</h2>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          <tr>
            <td style={labelStyle}>Host Disk usage</td>
            <td style={valueStyle}>
              {health.dataVolumeDisk.used} / {health.dataVolumeDisk.total} ({health.dataVolumeDisk.percent})
            </td>
          </tr>
          <tr>
            <td style={labelStyle}>Host Memory</td>
            <td style={valueStyle}>
              {formatBytes(health.memory.total - health.memory.available)} / {formatBytes(health.memory.total)} used
            </td>
          </tr>
          {health.memory.swapTotal > 0 && (
            <tr>
              <td style={labelStyle}>Swap</td>
              <td style={valueStyle}>
                {formatBytes(health.memory.swapTotal - health.memory.swapFree)} / {formatBytes(health.memory.swapTotal)}{' '}
                used
              </td>
            </tr>
          )}
          <tr>
            <td style={labelStyle}>Workspaces size</td>
            <td style={valueStyle}>
              {workspacesSize ?? (
                <button disabled={duPending} onClick={() => startTransition(duAction)}>
                  {duPending ? 'Computing...' : 'Compute'}
                </button>
              )}
              {duError && <span style={{ color: '#dc2626', marginLeft: 8 }}>{duError}</span>}
            </td>
          </tr>
          <tr>
            <td style={labelStyle}>Load average</td>
            <td style={valueStyle}>{health.loadAvg.map(n => n.toFixed(2)).join(', ')}</td>
          </tr>
          <tr>
            <td style={labelStyle}>Workbench uptime</td>
            <td style={valueStyle}>{formatUptime(health.uptime)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  )
}
