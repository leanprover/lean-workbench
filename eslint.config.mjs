import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import prettier from 'eslint-config-prettier/flat'
import noRelativeImportPaths from 'eslint-plugin-no-relative-import-paths'
import { defineConfig, globalIgnores } from 'eslint/config'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // vscode-workbench:
    '*/dist/',
    '*/.vscode-test/',
    // Default ignores of eslint-config-next:
    '.next/',
    'out/',
    'build/',
    'next-env.d.ts',
    'branch-*/',
  ]),
  {
    files: ['src/**/*.{mts,ts,tsx}'],
    plugins: { 'no-relative-import-paths': noRelativeImportPaths },
    rules: {
      'no-relative-import-paths/no-relative-import-paths': [
        'warn',
        { allowSameFolder: true, rootDir: 'src', prefix: '@' },
      ],
    },
  },
])

export default eslintConfig
