import Image from 'next/image'

import type { User } from '@/lib/server/auth'

export default function AvatarIcon({ user }: { user: Pick<User, 'name' | 'image'> }) {
  return (
    <button className='avatar-btn'>
      {user.image ? (
        <Image src={user.image} alt={user.name} width={28} height={28} loading='eager' />
      ) : (
        <span className='avatar-placeholder'>{user.name[0].toUpperCase()}</span>
      )}
    </button>
  )
}
