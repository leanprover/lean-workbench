import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactCompiler: true,
  typedRoutes: true,
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
}

export default nextConfig
