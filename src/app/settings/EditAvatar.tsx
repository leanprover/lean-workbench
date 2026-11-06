'use client'

import { useTransition } from 'react'
import { Button, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components'

import { useReloadSession } from '@/lib/client/auth'
import { useThrowToBoundary } from '@/lib/client/util'
import { type User } from '@/lib/server/auth'
import { type ActionResponse } from '@/lib/util'

import { clearUserAvatar, setUserAvatarGithub } from './actions'

interface EditAvatarProps {
  user: User
}

export function EditAvatar({ user }: EditAvatarProps) {
  const [pending, startTransition] = useTransition()
  const reloadSession = useReloadSession()
  const reloadOrErr: (msg: string) => (res: ActionResponse<null>) => Promise<void> = msg => async res => {
    if ('error' in res) {
      alert(`${msg}: ${res.error}`)
    } else {
      await reloadSession()
    }
  }
  const { throwToBoundary } = useThrowToBoundary()

  return (
    <MenuTrigger>
      <Button isPending={pending} style={{ padding: 5, fontSize: 20 }} aria-label='Edit avatar'>
        ✏️
      </Button>
      <Popover className='avatar-dropdown' placement='end top' offset={4}>
        <Menu>
          {user.image && (
            <MenuItem
              onAction={() =>
                startTransition(() =>
                  clearUserAvatar()
                    .then(reloadOrErr('Unexpected error, unable to clear avatar'))
                    .catch(throwToBoundary),
                )
              }
            >
              Clear User Picture
            </MenuItem>
          )}
          {!user.image && (
            <MenuItem
              onAction={() =>
                startTransition(() =>
                  setUserAvatarGithub().then(reloadOrErr('Could not set avatar')).catch(throwToBoundary),
                )
              }
            >
              Use Github User Picture
            </MenuItem>
          )}
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
