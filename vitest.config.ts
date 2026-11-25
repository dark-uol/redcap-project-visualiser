import { defineConfig } from 'vitest/config';
import solid from '@solidjs/vite-plugin';

// Separate from vite.config.ts so the base-path logic stays out of tests. The Solid plugin compiles the JSX in
// component tests (*.test.tsx), which render pure views into a jsdom element.
// The 'browser' condition makes solid-js resolve to its client build (reactive signals) instead of the server build.
export default defineConfig({
  plugins: [solid()],
  resolve: { conditions: ['browser'] },
  test: { environment: 'jsdom', include: ['test/**/*.test.{ts,tsx}'] },
});
