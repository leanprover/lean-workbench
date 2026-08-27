'use client'

import { startTransition, use, useState } from 'react'

import { fetchDiskUsage, fetchHealth, type SystemHealth } from '@/app/admin/actions'
import CatchySuspense from '@/app/components/CatchySuspense'
import { useServerAction, useThrowingSWR } from '@/lib/client/util'

import { formatBytes, formatUptime } from './utils'

const labelStyle = { padding: '4px 12px 4px 0', color: '#666' }
const valueStyle = { padding: '4px 0' }

interface HealthMonitorProps {
  systemHealth: Promise<SystemHealth>
}

export function HealthMonitor(props: HealthMonitorProps) {
  return (
    <section>
      <h2>System health</h2>
      <CatchySuspense loading={<p>Loading&hellip;</p>} error={<p style={{ color: '#dc2626' }}>Failed to load</p>}>
        <HealthMonitorData {...props} />
      </CatchySuspense>
    </section>
  )
}

function HealthMonitorData(props: HealthMonitorProps) {
  const systemHealth = use(props.systemHealth)
  const { data: health } = useThrowingSWR<SystemHealth>('adminHealth', () => fetchHealth(), {
    fallbackData: systemHealth,
    revalidateOnMount: false,
    refreshInterval: 30_000,
  })
  const [workspacesSize, setWorkspacesSize] = useState<string | null>(null)
  const [duError, duAction, duPending] = useServerAction(fetchDiskUsage, ({ workspaces }) =>
    setWorkspacesSize(workspaces),
  )

  return (
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
  )
}
