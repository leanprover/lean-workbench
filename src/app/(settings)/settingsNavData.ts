export const settings = [
  {
    title: 'Account',
    routes: [{ href: '/settings', label: 'User profile' }],
    admin: false,
  },
  {
    title: 'Admin',
    routes: [
      { href: '/admin', label: 'System' },
      { href: '/admin/accounts', label: 'Accounts' },
      { href: '/admin/sessions', label: 'Editor sessions' },
      { href: '/admin/lean', label: 'Lean artifacts' },
    ],
    admin: true,
  },
] as const
