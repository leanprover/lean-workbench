import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  base: '/static/dist/',
  build: {
    outDir: '../public/dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        profile: 'src/profile.tsx',
        admin: 'src/admin.tsx',
      },
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3002',
      '/dev-login': 'http://localhost:3002',
      '/logout': 'http://localhost:3002',
    },
  },
})
