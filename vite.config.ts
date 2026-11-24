import { defineConfig, loadEnv } from 'vite';
import solid from '@solidjs/vite-plugin';

// GitHub Pages serves project sites from a sub-path (e.g. /repo-name/). The deploy
// workflow passes it as BASE_PATH; locally it is unset and the app is served from '/'.
function normalizeBase(raw: string | undefined): string {
  const trimmed = (raw ?? '').replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? '/' : '/' + trimmed + '/';
}

export default defineConfig(function configure({ mode }) {
  const environment = loadEnv(mode, '.', '');
  return {
    base: normalizeBase(environment.BASE_PATH),
    plugins: [solid()],
  };
});
