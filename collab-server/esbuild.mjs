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
})

if (watch) {
  await ctx.watch()
} else {
  await ctx.rebuild()
  await ctx.dispose()
}
