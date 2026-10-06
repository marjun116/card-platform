import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['**/dist/', '**/coverage/', '**/generated/']),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Game files are data, never code: nothing may evaluate strings as code.
  {
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },

  {
    files: ['*.{js,ts}', 'apps/server/**/*.ts', '**/vite.config.ts', '**/vitest.config.ts'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },

  // The engine is pure: no I/O, no clock, and no randomness except the
  // seeded RNG passed in through game state.
  {
    files: ['packages/engine/src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the seeded RNG from game state so games can be replayed.',
        },
      ],
      'no-restricted-globals': [
        'error',
        ...['Date', 'process', 'fetch', 'setTimeout', 'setInterval', 'performance'].map((name) => ({
          name,
          message: 'The engine must stay pure: no clock, I/O or timers.',
        })),
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'node:*',
                'fs',
                'fs/*',
                'path',
                'http',
                'https',
                'net',
                'child_process',
                'os',
              ],
              message: 'The engine must not do I/O.',
            },
            {
              group: ['@card-table/*', 'react', 'react-dom', 'fastify', '@prisma/*'],
              message: 'The engine must not depend on games, server or UI code.',
            },
          ],
        },
      ],
    },
  },

  prettier,
]);
