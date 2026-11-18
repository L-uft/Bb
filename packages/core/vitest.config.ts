import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Live network tests only run with LIVE=1 (npm run test:live).
    exclude: process.env.LIVE ? [] : ['test/live/**'],
    testTimeout: 30_000,
  },
});
