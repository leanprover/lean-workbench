import { defineConfig } from '@vscode/test-cli'

const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH

if (!vscodeExecutablePath) {
  console.error('VSCODE_EXECUTABLE_PATH must be set to VS Code with code-server-patches/ applied.')
  process.exit(1)
}

export default defineConfig({
  files: 'out/test/**/*.test.js',
  // Stable VS Code gates proposed APIs behind this flag:
  // `enabledApiProposals` in package.json is ignored without it.
  launchArgs: ['--enable-proposed-api', 'leanprover.workbench'],
  useInstallation: {
    fromPath: vscodeExecutablePath,
  },
})
