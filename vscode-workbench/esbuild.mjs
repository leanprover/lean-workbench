import esbuild from 'esbuild'

const isProd = process.argv.includes('--production')
const watch = process.argv.includes('--watch')

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  minify: isProd,
  sourcemap: !isProd,
  platform: 'node',
  target: 'node22',
})

if (watch) {
  await ctx.watch()
} else {
  await ctx.rebuild()
  await ctx.dispose()
}
