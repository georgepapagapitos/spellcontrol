// Guard (E1120): every router server.ts mounts that can reach Postgres sits
// behind the boot gate.
//
// The server listens before the schema is applied (db/readiness.ts). A router
// that reaches db/index.ts, directly or through any import, and is mounted
// without `requireDb` or `dbGate(...)` would run against a database that is
// unreachable or has no tables yet: a request waits out the 10 s connect
// timeout and fails with a 500 instead of a fast 503 with Retry-After.
//
// The fix when this fails: add `requireDb` to the router's `app.use(...)` line
// in server.ts (or `dbGate({ except | only })` when part of it needs no
// database). Add a router to DB_FREE only if it really never reaches
// db/index.ts (this test checks), and to SELF_GATED only if it checks
// `isDbReady()` itself, with the reason.
//
// Reads source rather than booting the app, like security-headers.test.ts.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = __dirname;
const SERVER = path.join(SRC, 'server.ts');
const DB_INDEX = path.join(SRC, 'db', 'index.ts');

/** Mounted with no gate because they never touch Postgres. */
const DB_FREE = new Set([
  'cardImagesRouter',
  'cardLookupRouter',
  'mpcRouter',
  'scannerRouter',
  'spellbookRouter',
]);

/** Mounted with no gate because they check readiness themselves. */
const SELF_GATED: Record<string, string> = {
  eventsRouter:
    'a client-error beacon feeds the in-memory burst alert, the one signal left while the database is down; the router skips its writes until the schema is in',
};

function resolveImport(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts'), base]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const IMPORT_RE =
  /(?:import|export)\s+(type\s+)?[^'";]*?from\s+'(\.[^']+)'|import\(\s*'(\.[^']+)'\s*\)/g;

/** Whether `entry` reaches db/index.ts through value imports. */
function reachesDb(entry: string): boolean {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    if (file === DB_INDEX) return true;
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
      if (m[1]) continue; // `import type` never loads the module
      const next = resolveImport(file, m[2] ?? m[3]);
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/** Every `app.use(...)` call's argument text, parentheses matched. */
function appUseCalls(src: string): string[] {
  const calls: string[] = [];
  for (let i = src.indexOf('app.use('); i !== -1; i = src.indexOf('app.use(', i + 1)) {
    let depth = 0;
    let quote = '';
    for (let j = i + 'app.use'.length; j < src.length; j++) {
      const c = src[j];
      if (quote) {
        if (c === quote && src[j - 1] !== '\\') quote = '';
      } else if (c === "'" || c === '"' || c === '`') quote = c;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c) && --depth === 0) {
        calls.push(src.slice(i + 'app.use('.length, j));
        break;
      }
    }
  }
  return calls;
}

describe('server.ts database gate', () => {
  const src = readFileSync(SERVER, 'utf8');

  const routerFiles = new Map<string, string>();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.\/routes\/[^']+)'/g)) {
    const file = resolveImport(SERVER, m[2]);
    for (const name of m[1].split(',').map((s) => s.trim())) {
      if (file && /Router$/.test(name)) routerFiles.set(name, file);
    }
  }

  const mounts = appUseCalls(src)
    .map((args) => ({
      args,
      router: /\b(\w+Router)\s*$/.exec(args.trim())?.[1],
      gated: /\brequireDb\b|\bdbGate\(/.test(args),
    }))
    .filter((m): m is { args: string; router: string; gated: boolean } => !!m.router);

  it('finds the routers server.ts mounts', () => {
    expect(mounts.length).toBeGreaterThan(30);
    for (const { router } of mounts) expect(routerFiles.has(router), router).toBe(true);
  });

  it('gates every router that reaches db/index.ts', () => {
    const ungated = mounts
      .filter((m) => !m.gated && !DB_FREE.has(m.router) && !(m.router in SELF_GATED))
      .filter((m) => reachesDb(routerFiles.get(m.router)!))
      .map((m) => `${m.router} (app.use(${m.args.trim()}))`);
    expect(ungated, 'Add requireDb to the mount in server.ts').toEqual([]);
  });

  it('keeps the database-free list true', () => {
    for (const name of DB_FREE) {
      expect(reachesDb(routerFiles.get(name)!), `${name} reaches db/index.ts`).toBe(false);
    }
  });

  it('lists only routers that are really mounted without a gate', () => {
    const ungatedNames = new Set(mounts.filter((m) => !m.gated).map((m) => m.router));
    for (const name of [...DB_FREE, ...Object.keys(SELF_GATED)]) {
      expect(ungatedNames.has(name), `${name} is listed but gated or not mounted`).toBe(true);
    }
    for (const name of Object.keys(SELF_GATED)) {
      const file = readFileSync(routerFiles.get(name)!, 'utf8');
      expect(file, `${name} must check isDbReady()`).toMatch(/\bisDbReady\(\)/);
    }
  });
});
