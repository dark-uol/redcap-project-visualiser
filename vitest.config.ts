import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so tests don't load the Solid plugin; they only cover plain modules.
export default defineConfig({
  test: { environment: 'jsdom', include: ['test/**/*.test.ts'] },
});
