import { defineConfig } from '@vscode/test-cli'

export default defineConfig({
  files: 'out/test/**/*.test.js',
  // Stable VS Code gates proposed APIs behind this flag:
  // `enabledApiProposals` in package.json is ignored without it.
  launchArgs: ['--enable-proposed-api', 'leanprover.workbench'],
})
