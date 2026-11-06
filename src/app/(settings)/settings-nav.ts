export const settingsNav = [
  {
    title: 'Account',
    routes: [{ href: '/settings', label: 'User profile' }],
    admin: false,
  },
  {
    title: 'Admin',
    routes: [{ href: '/admin', label: 'Admin settings' }],
    admin: true,
  },
] as const
