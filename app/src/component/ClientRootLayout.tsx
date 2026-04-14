'use client'

import authClient from '@/lib/auth-client'
import { BreadcrumbsCtx, Config, ConfigCtx } from '@/lib/contexts'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useContext, useState, type ReactNode } from 'react'

function AvatarMenu() {
  const router = useRouter()
  const session = authClient.useSession()
  const cfg = useContext(ConfigCtx)

  if (!session.data) {
    if (cfg.isSetupComplete && cfg.hasGithubAuth)
      return (
        <button className="nav-link" onClick={() => authClient.signIn.social({ provider: 'github' })}>
          Sign in via GitHub
        </button>
      )
    else return <></>
  } else {
    const user = session.data.user
    return (
      <>
        {user.isAdmin && <span className="admin-badge">admin</span>}
        <div className="avatar-menu">
          <button className="avatar-btn">
            {user.image ? (
              <Image src={user.image} alt={user.name} width={28} height={28} />
            ) : (
              <span className="avatar-placeholder">{user.name[0].toUpperCase()}</span>
            )}
          </button>
          <div className="avatar-dropdown">
            <div className="avatar-dropdown-user">{user.name}</div>
            {/* TODO admin route {user.isAdmin && <Link href='/admin'>Admin interface</Link>} */}
            <button
              onClick={() => {
                authClient.signOut({
                  fetchOptions: {
                    onSuccess: () => {
                      router.push('/')
                    },
                  },
                })
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </>
    )
  }
}

export default function ClientRootLayout({ cfg, children }: Readonly<{ cfg: Config; children: ReactNode }>) {
  const [breadcrumbs, setBreadcrumbs] = useState<ReactNode>(null)
  return (
    <ConfigCtx value={cfg}>
      <nav>
        <Link className="logo" href="/">
          <Image src="/lean-logo.svg" alt="Lean logo" width={70} height={20} />
          <span className="logo-text">Lean Workbench</span>
        </Link>
        {breadcrumbs}
        <span className="spacer"></span>
        <AvatarMenu />
      </nav>
      <BreadcrumbsCtx value={setBreadcrumbs}>{children}</BreadcrumbsCtx>
    </ConfigCtx>
  )
}
