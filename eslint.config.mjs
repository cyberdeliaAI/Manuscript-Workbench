import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', '.venv/', 'build/', 'electron/out/'] },
  js.configs.recommended,
  {
    files: ['static/js/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser } },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    // The desktop app (Electron main process) and its build helpers are CommonJS for Node.
    files: ['electron/**/*.cjs', 'tools/**/*.cjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // The cleaning and diagnostics code works with control characters and zero-width characters on purpose.
    files: ['static/js/core/**/*.js'],
    rules: { 'no-control-regex': 'off', 'no-misleading-character-class': 'off', 'no-useless-escape': 'off' },
  },
];
