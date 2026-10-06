import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'engine',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/__fixtures__/**'],
    },
  },
});
