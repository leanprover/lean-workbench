import esbuild from 'esbuild'

const isProd = process.argv.includes('--production')
const watch = process.argv.includes('--watch')

const ctx = await esbuild.context({
  entryPoints: ['src/server.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/server.js',
  minify: isProd,
  sourcemap: !isProd,
  platform: 'node',
  target: 'node24',
  // Bundled @prisma/client uses require('node:path'),
  // which esbuild rewrites (in ESM output) to a __require shim that throws.
  // Define a real require (https://github.com/evanw/esbuild/issues/1921).
  // @prisma/client actually includes an ESM build,
  // but their package.json insists on the CJS bundle in Node builds
  // (https://github.com/prisma/prisma/issues/28126#issuecomment-3783273271).
  banner: {
    js: "import { createRequire as __collab_server_createRequire } from 'node:module'; const require = __collab_server_createRequire(import.meta.url);",
  },
})

if (watch) {
  await ctx.watch()
} else {
  await ctx.rebuild()
  await ctx.dispose()
}
