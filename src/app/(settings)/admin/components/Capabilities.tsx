'use client'

import { type ReactNode, useState } from 'react'
import { Button, SwitchButton, SwitchField } from 'react-aria-components'

import { useConfigCtx } from '@/lib/contexts'

interface ArmedToggleProps {
  settingEnabled: boolean
  children: ReactNode
}

function ArmedToggle({ settingEnabled, children }: ArmedToggleProps) {
  const [armed, setArmed] = useState(false)

  return (
    <li>
      <span>
        {children}: <strong>{settingEnabled ? 'Enabled' : 'Disabled'}</strong>
      </span>
      <div className='actions'>
        {!armed && <Button onClick={() => setArmed(true)}>{settingEnabled ? 'Disable' : 'Enable'}</Button>}
        {armed && (
          <>
            <Button>{settingEnabled ? 'Confirm: Disable?' : 'Confirm: Enable?'}</Button>
            <Button onClick={() => setArmed(false)}>Cancel</Button>
          </>
        )}
      </div>
    </li>
  )
}

export function Capabilities() {
  const cfg = useConfigCtx()

  return (
    <section>
      <h2>System Capabilities</h2>
      <ul className='action-list'>
        <ArmedToggle settingEnabled={cfg.isPublishingEnabled}>Project publications</ArmedToggle>
        <ArmedToggle settingEnabled={cfg.isPublicProjectSharingEnabled}>Sharable projects</ArmedToggle>
      </ul>

      <ul style={{ listStyle: 'none' }}>
        <li>
          <SwitchField>
            <SwitchButton>
              {({ isSelected, isDisabled }) => (
                <>
                  <div className='track indicator'>
                    <div
                      data-disabled={isDisabled || undefined}
                      className={isSelected ? 'handle' : 'handle indicator'}
                    />
                  </div>
                  Sharable projects disabled
                </>
              )}
            </SwitchButton>{' '}
          </SwitchField>
        </li>
        <li>
          <SwitchField>
            <SwitchButton>
              {({ isSelected, isDisabled }) => (
                <>
                  <div className='track indicator'>
                    <div
                      data-disabled={isDisabled || undefined}
                      className={isSelected ? 'handle' : 'handle indicator'}
                    />
                  </div>
                  Project publications enabled ➜ disabled (<a href=''>confirm</a> or <a href=''>cancel</a>)
                </>
              )}
            </SwitchButton>
          </SwitchField>
        </li>
      </ul>
    </section>
  )
}
