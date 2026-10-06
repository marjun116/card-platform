import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'engine',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/__fixtures__/**'],
      // The engine must stay well tested: `pnpm test:coverage` fails below these.
      thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
    },
  },
});
