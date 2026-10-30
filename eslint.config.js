import js from '@eslint/js'
import globals from 'globals'
import prettier from 'eslint-config-prettier'

export default [
  { ignores: ['dist/**', 'coverage/**', '**/dist/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.browser },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  {
    files: ['**/test/**', '**/scripts/**', '**/*.config.js', 'server/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  prettier,
]
