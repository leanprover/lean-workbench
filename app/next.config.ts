import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactCompiler: true,
  typedRoutes: true,
  turbopack: {
    // Without this, Turbopack uses the parent dir as root
    root: import.meta.dirname,
  },
}

export default nextConfig
