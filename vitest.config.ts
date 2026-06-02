import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    environmentOptions: {
      jsdom: { url: 'http://localhost:5173' },
    },
    setupFiles: ['tests/jsdom-setup.ts'],
  },
});
