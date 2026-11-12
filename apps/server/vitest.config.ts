import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use forks pool instead of threads for native module compatibility
    // (better-sqlite3 has issues with thread workers)
    pool: 'forks',
    setupFiles: ['./src/logging/quietLogsInTests.ts'],
  },
});
