'use client'

import { useEffect, useState } from 'react'
import { fetchDiskUsage, fetchHealth } from '../actions'
import type { HealthInfo } from './types'
import { formatBytes, formatUptime } from './utils'

export function HealthMonitor({ initialHealth }: { initialHealth: HealthInfo }) {
  const [health, setHealth] = useState(initialHealth)
  const [workspacesSize, setWorkspacesSize] = useState<string | null>(null)
  const [duLoading, setDuLoading] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => {
      fetchHealth()
        .then(setHealth)
        .catch(() => {})
    }, 30_000)
    return () => clearInterval(interval)
  }, [])

  return (
    <section>
      <h2>System health</h2>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          <tr>
            <td style={{ padding: '4px 12px 4px 0', color: '#666' }}>Host Disk usage</td>
            <td style={{ padding: '4px 0' }}>
              {health.dataVolumeDisk.used} / {health.dataVolumeDisk.total} ({health.dataVolumeDisk.percent})
            </td>
          </tr>
          <tr>
            <td style={{ padding: '4px 12px 4px 0', color: '#666' }}>Host Memory</td>
            <td style={{ padding: '4px 0' }}>
              {formatBytes(health.memory.total - health.memory.available)} / {formatBytes(health.memory.total)} used
            </td>
          </tr>
          {health.memory.swapTotal > 0 && (
            <tr>
              <td style={{ padding: '4px 12px 4px 0', color: '#666' }}>Swap</td>
              <td style={{ padding: '4px 0' }}>
                {formatBytes(health.memory.swapTotal - health.memory.swapFree)} / {formatBytes(health.memory.swapTotal)}{' '}
                used
              </td>
            </tr>
          )}
          <tr>
            <td style={{ padding: '4px 12px 4px 0', color: '#666' }}>Workspaces size</td>
            <td style={{ padding: '4px 0' }}>
              {workspacesSize ?? (
                <button
                  disabled={duLoading}
                  onClick={() =>
                    void (async () => {
                      setDuLoading(true)
                      try {
                        const { workspaces } = await fetchDiskUsage()
                        setWorkspacesSize(workspaces)
                      } catch {
                        setWorkspacesSize('error')
                      }
                      setDuLoading(false)
                    })()
                  }
                >
                  {duLoading ? 'Computing...' : 'Compute'}
                </button>
              )}
            </td>
          </tr>
          <tr>
            <td style={{ padding: '4px 12px 4px 0', color: '#666' }}>Load average</td>
            <td style={{ padding: '4px 0' }}>{health.loadAvg.map(n => n.toFixed(2)).join(', ')}</td>
          </tr>
          <tr>
            <td style={{ padding: '4px 12px 4px 0', color: '#666' }}>Workbench uptime</td>
            <td style={{ padding: '4px 0' }}>{formatUptime(health.uptime)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  )
}
