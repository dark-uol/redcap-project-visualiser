import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import solid from '@solidjs/vite-plugin';

// GitHub Pages serves project sites from a sub-path (e.g. /repo-name/). The deploy
// workflow passes it as BASE_PATH; locally it is unset and the app is served from '/'.
function normalizeBase(raw: string | undefined): string {
  const trimmed = (raw ?? '').replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? '/' : '/' + trimmed + '/';
}

// The files Pyodide fetches at run time. Self-hosted from the npm package so the app stays client-only and works offline;
// the Python sources are not here: they are bundled as text (src/lib/pythonEngine.ts).
const PYODIDE_FILES: Record<string, string> = {
  'pyodide.asm.mjs': 'text/javascript',
  'pyodide.asm.wasm': 'application/wasm',
  'python_stdlib.zip': 'application/zip',
  'pyodide-lock.json': 'application/json',
};

/** Serves the Pyodide runtime at /pyodide/ in development and copies it to dist/pyodide/ in a build. */
function pyodideRuntime(): Plugin {
  const directory = join('node_modules', 'pyodide');
  return {
    name: 'pyodide-runtime',
    configureServer(server) {
      server.middlewares.use('/pyodide/', function servePyodide(request, response, next) {
        const name = (request.url ?? '').split('?')[0]!.replace(/^\//, '');
        const type = PYODIDE_FILES[name];
        if (!type) return next();
        response.setHeader('Content-Type', type);
        response.end(readFileSync(join(directory, name)));
      });
    },
    generateBundle() {
      Object.keys(PYODIDE_FILES).forEach((name) => {
        this.emitFile({ type: 'asset', fileName: 'pyodide/' + name, source: readFileSync(join(directory, name)) });
      });
    },
  };
}

export default defineConfig(function configure({ mode }) {
  const environment = loadEnv(mode, '.', '');
  return {
    base: normalizeBase(environment.BASE_PATH),
    plugins: [solid(), pyodideRuntime()],
  };
});
