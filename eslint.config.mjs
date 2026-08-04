import eslint from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import prettier from 'eslint-config-prettier/flat'
import noRelativeImportPaths from 'eslint-plugin-no-relative-import-paths'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import unusedImports from 'eslint-plugin-unused-imports'
import tseslint from 'typescript-eslint'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // vscode-workbench:
    '*/dist/',
    '*/.vscode-test/',
    'vscode-workbench/src/vscode.proposed.*.d.ts',
    // Default ignores of eslint-config-next:
    '.next/',
    'out/',
    'build/',
    'next-env.d.ts',
    'branch-*/',
  ]),
  {
    extends: [eslint.configs.recommended],
    plugins: {
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'simple-import-sort/imports': 'warn',
      'unused-imports/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Typescript rules
    files: ['**/*.{mts,ts,tsx}'],
    extends: tseslint.configs.recommendedTypeChecked,
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          // these exceptions reduce unnecessary friction with React stuff
          checksVoidReturn: {
            arguments: false,
            attributes: false,
          },
        },
      ],
      '@typescript-eslint/restrict-template-expressions': 'off', // always allow `${x}` regardless of x's type
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }], // allow (x) => console.log(x), ban const x = console.log(x)
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unsafe-member-access': ['error', { allowOptionalChaining: true }], // optional chaining helps with tests
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'error', // complements how strict works in typescript for chained promises
    },
  },
  {
    // Rules that only make sense in the app
    files: ['src/**/*.{mts,ts,tsx}'],
    plugins: { 'no-relative-import-paths': noRelativeImportPaths },
    rules: {
      '@typescript-eslint/require-await': 'off', // `'use server'` modules must only export async
      'no-relative-import-paths/no-relative-import-paths': [
        'warn',
        { allowSameFolder: true, rootDir: 'src', prefix: '@' },
      ],
    },
  },
  {
    // Test files may need to make use of the `any` type in a way we want to
    // prevent in normal code.
    files: ['**/*.{spec,test}.{ts,tsx}', '**/tests/**'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
])

export default eslintConfig
