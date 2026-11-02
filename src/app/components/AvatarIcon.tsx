import Image from 'next/image'

import type { User } from '@/lib/server/auth'

export function AvatarIcon({
  user,
  size: maybeSize,
}: {
  user: Pick<User, 'name' | 'image' | 'displayName'>
  size?: number
}) {
  const size = maybeSize ?? 28

  if (user.image) {
    return (
      <span>
        <Image className='avatar-image' src={user.image} alt={user.name} width={size} height={size} loading='eager' />
      </span>
    )
  }

  const firstAlphaNum = user.displayName?.match(/[a-zA-Z0-9]/)?.[0] ?? user.name[0]!
  return (
    <span>
      <span className='avatar-placeholder' style={{ width: size, height: size, fontSize: size / 2.5 }}>
        {firstAlphaNum.toUpperCase()}
      </span>
    </span>
  )
}
