import { describe, expect, it } from 'vitest';

/*
 * The pure-view convention (CLAUDE.md): a view file never imports the store, directly or through anything it imports.
 * Nothing else enforces it (there is no linter), so this walks each view's relative imports looking for `store`.
 */
const sources = import.meta.glob<string>('../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });
const COMPONENTS = '../src/components/';
/** `GraphView.tsx` is the graph tab's connector; its name only looks like a view. */
const CONNECTORS_NAMED_LIKE_VIEWS = new Set(['GraphView.tsx']);

const isViewFile = (file: string): boolean =>
  file.startsWith(COMPONENTS) && /Views?\.tsx$/.test(file) && !CONNECTORS_NAMED_LIKE_VIEWS.has(file.slice(file.lastIndexOf('/') + 1));

const importsOf = (file: string): string[] =>
  [...sources[file].matchAll(/^(?:import|export)\s[^;]*?from\s+'([^']+)'/gm)].map((match) => match[1]);

/** `specifier` as a path relative to the same root as the glob keys, with `.` and `..` folded away. */
function resolveSpecifier(from: string, specifier: string): string {
  const segments = from.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '..') segments.pop();
    else if (part !== '.') segments.push(part);
  }
  return segments.join('/');
}

const sourceFileFor = (path: string): string | undefined =>
  ['.ts', '.tsx', '/index.ts', '/index.tsx'].map((suffix) => path + suffix).find((candidate) => candidate in sources);

/** The first import chain from `file` that reaches the store, or null. */
function chainToStore(file: string, seen = new Set<string>()): string[] | null {
  if (seen.has(file)) return null;
  seen.add(file);
  for (const specifier of importsOf(file)) {
    if (!specifier.startsWith('.')) continue;
    const path = resolveSpecifier(file, specifier);
    if (/(^|\/)store(\/|$)/.test(path)) return [file, specifier];
    const target = sourceFileFor(path);
    const chain = target ? chainToStore(target, seen) : null;
    if (chain) return [file, ...chain];
  }
  return null;
}

describe('pure views', () => {
  const views = Object.keys(sources).filter(isViewFile);

  it('finds the view files', () => {
    expect(views.length).toBeGreaterThan(15);
  });

  it.each(views.map((file) => [file.slice(COMPONENTS.length), file]))('%s never reaches the store', (_name, file) => {
    expect(chainToStore(file)).toBeNull();
  });

  it('detects a connector, so the check is not vacuous', () => {
    expect(chainToStore(COMPONENTS + 'Legend.tsx')).not.toBeNull();
    expect(chainToStore(COMPONENTS + 'GraphView.tsx')).not.toBeNull();
  });
});
