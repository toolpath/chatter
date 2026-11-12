import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    server: {
      deps: {
        // Node cannot load the Toolpath UI package by itself (its table library imports folders),
        // so Vite builds it for the tests, as it does for the app
        inline: [/@toolpath\/ui/, /@table-library/],
      },
    },
  },
});
