import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactCompiler: true,
  typedRoutes: true,
  cacheComponents: true,
  experimental: {
    authInterrupts: true,
  },
  turbopack: {
    // Without this, Turbopack uses the parent dir as root
    root: import.meta.dirname,
  },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'avatars.githubusercontent.com', pathname: '/u/**' }],
  },
  logging: {
    incomingRequests: {
      // Noisy route - VSC makes a lot of requests.
      ignore: [/^\/api\/auth-vsc\//],
    },
  },
}

export default nextConfig
