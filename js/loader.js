/* Load third-party libs from CDN(s), falling back to ./vendor. Plain <script> injection: works on file://. */
(function (g) {
  'use strict';
  const RC = (g.RC = g.RC || {});

  const LIBS = {
    mermaid: {
      global: 'mermaid',
      urls: [
        'https://cdn.jsdelivr.net/npm/mermaid@11.4.0/dist/mermaid.min.js',
        'https://unpkg.com/mermaid@11.4.0/dist/mermaid.min.js',
        'vendor/mermaid.min.js',
      ],
    },
    viz: {
      global: 'Viz',
      urls: [
        'https://cdn.jsdelivr.net/npm/@viz-js/viz@3.11.0/lib/viz-standalone.js',
        'https://unpkg.com/@viz-js/viz@3.11.0/lib/viz-standalone.js',
        'vendor/viz-standalone.js',
      ],
    },
  };
  const pending = {};

  function tryUrl(url, global, timeout) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      const timer = setTimeout(() => { s.remove(); reject(new Error('timeout')); }, timeout);
      s.onload = () => { clearTimeout(timer); g[global] ? resolve() : reject(new Error('global missing')); };
      s.onerror = () => { clearTimeout(timer); s.remove(); reject(new Error('load error')); };
      s.src = url;
      document.head.appendChild(s);
    });
  }

  /** Resolves with the global; rejects only when every source failed. Reports the source used. */
  RC.loadLib = function (name, onStatus) {
    const lib = LIBS[name];
    if (g[lib.global]) return Promise.resolve(g[lib.global]);
    if (pending[name]) return pending[name];
    pending[name] = (async () => {
      for (const url of lib.urls) {
        const local = !/^https?:/.test(url);
        onStatus && onStatus(`Loading ${name} from ${local ? 'local vendor/ fallback' : new URL(url).host}…`);
        try {
          await tryUrl(url, lib.global, local ? 30000 : 12000);
          onStatus && onStatus(`${name} loaded (${local ? 'local fallback' : new URL(url).host})`);
          RC.libSource = RC.libSource || {};
          RC.libSource[name] = local ? 'local' : 'cdn';
          return g[lib.global];
        } catch (e) { /* try next */ }
      }
      delete pending[name];
      throw new Error(`Could not load ${name} from CDN or vendor/ folder`);
    })();
    return pending[name];
  };

  // ---- SolidJS: ESM from CDN via dynamic import() (allowed from file://), else local classic-script bundle ----
  const SOLID_VER = '1.9.3';
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  RC.loadSolid = async function () {
    const cdns = [`https://esm.sh/solid-js@${SOLID_VER}`];
    for (const base of cdns) {
      try {
        const [core, web, html] = await withTimeout(
          Promise.all([import(base), import(base + '/web'), import(base + '/html')]), 12000);
        return Object.assign({}, core, web, { html: html.default });
      } catch (e) { /* fall through */ }
    }
    if (!g.SolidBundle) await tryUrl('vendor/solid.iife.js', 'SolidBundle', 15000);
    return g.SolidBundle;
  };
})(window);
