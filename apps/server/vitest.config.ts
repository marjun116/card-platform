import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Full games over WebSockets take a few seconds, more on slow CI machines.
  test: { name: 'server', testTimeout: 30_000 },
});
