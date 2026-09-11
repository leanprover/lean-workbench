import { type Route } from 'next'
import Link from 'next/link'
import { MenuItem, type MenuItemProps } from 'react-aria-components'

/**
 * Next.js adapter for React Aria's MenuItems that should navigate with Link behavior via the Next router.
 */
export default function MenuLinkItem<Href extends string>({
  href,
  ...props
}: Omit<MenuItemProps, 'href' | 'render'> & { href: Route<Href> }) {
  return (
    <MenuItem
      {...props}
      href={href}
      render={raProps => ('href' in raProps ? <Link {...raProps} href={href} /> : <div {...raProps} />)}
    />
  )
}
