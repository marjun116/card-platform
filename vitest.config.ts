import { defineConfig } from 'vitest/config';

// Runs every package's tests from the repo root. Each package has its own
// vitest.config.ts, so `pnpm test` also works inside a single package.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
});
