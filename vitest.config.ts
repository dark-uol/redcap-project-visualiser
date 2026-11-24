import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so tests don't load the Solid plugin; they only cover plain modules.
// The 'browser' condition makes solid-js resolve to its client build (reactive signals) instead of the server build.
export default defineConfig({
  resolve: { conditions: ['browser'] },
  test: { environment: 'jsdom', include: ['test/**/*.test.ts'] },
});
