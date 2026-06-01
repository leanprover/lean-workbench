import esbuild from 'esbuild'
import { glob } from 'node:fs/promises'

const isProd = process.argv.includes('--production')
const watch = process.argv.includes('--watch')
const tests = process.argv.includes('--tests')

const testFiles = async () => Array.fromAsync(glob('test/**/*.test.ts'))

const ctx = await esbuild.context({
  bundle: true,
  format: 'cjs',
  external: ['vscode'],
  sourcemap: !isProd,
  platform: 'node',
  target: 'node22',
  define: { 'import.meta.url': '__filename' },
  ...(tests
    ? { entryPoints: await testFiles(), outdir: 'out/test' }
    : { entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', minify: isProd }),
})

if (watch) {
  await ctx.watch()
} else {
  await ctx.rebuild()
  await ctx.dispose()
}
