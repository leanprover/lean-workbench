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
  // Lets bundled CommonJS dependencies `require` Node.js built-ins.
  // See https://github.com/evanw/esbuild/issues/1921
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
})

if (watch) {
  await ctx.watch()
} else {
  await ctx.rebuild()
  await ctx.dispose()
}
