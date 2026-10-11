import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['**/node_modules/**', 'packages/extension/dist/**', 'fixtures/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-control-regex': 'off',
      'no-misleading-character-class': 'off',
    },
  },
  {
    files: ['packages/core/src/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['node:*', 'fs', 'path', 'http', 'https', 'net'] },
      ],
    },
  },
  {
    files: ['packages/extension/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, chrome: 'readonly' } },
  },
];
