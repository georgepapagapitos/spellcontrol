// Guard: no source file grows past MAX_LINES, and the files already past it
// only shrink. The backend twin of frontend/src/test/file-size-ratchet.test.ts;
// read that header for the reasoning.
//
// When this guard landed (2026-09-29, board T176) 7 files in backend/src were
// over 1,000 lines; CEILINGS is that debt, each set at its size rounded up to
// the next 100. Never raise a ceiling or add an entry. A route file past the
// limit splits by sub-resource (routes/games.ts -> games/<topic>.ts handlers
// mounted by one router), the way every other domain already keeps its logic
// in src/<domain>/ and only the wiring in routes/.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const SRC = resolve(__dirname);
const MAX_LINES = 1000;
/** A ceiling this far above the file's real size is stale. */
const SLACK = 200;

const CEILINGS: Record<string, number> = {
  'db/schema.ts': 1300,
  'routes/ai.ts': 1300,
  'routes/auth.ts': 1400,
  'routes/friends.ts': 1200,
  'routes/game-nights.ts': 2100,
  'server.ts': 1600,
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry !== 'node_modules') sourceFiles(p, out);
    } else if (/\.ts$/.test(entry) && !/\.(test|fixtures|d)\.ts$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

describe('file size ratchet', () => {
  const sizes = new Map(
    sourceFiles(SRC).map(
      (f) =>
        [relative(SRC, f).split(sep).join('/'), readFileSync(f, 'utf8').split('\n').length] as const
    )
  );

  it('walks the real source tree', () => {
    expect(sizes.size).toBeGreaterThan(100);
  });

  it('keeps every file under its limit', () => {
    const over = [...sizes]
      .filter(([f, n]) => n > (CEILINGS[f] ?? MAX_LINES))
      .map(([f, n]) => `  ${f}: ${n} lines (limit ${CEILINGS[f] ?? MAX_LINES})`);
    expect(over, 'Split the file instead of growing it. Never raise a ceiling.').toEqual([]);
  });

  it('lowers a ceiling when its file shrinks', () => {
    const stale = Object.entries(CEILINGS)
      .filter(([f, ceiling]) => {
        const n = sizes.get(f);
        return n === undefined || n <= MAX_LINES || ceiling - n > SLACK;
      })
      .map(([f, ceiling]) => {
        const n = sizes.get(f);
        if (n === undefined) return `  ${f}: gone, delete the entry`;
        if (n <= MAX_LINES) return `  ${f}: ${n} lines, under ${MAX_LINES}, delete the entry`;
        return `  ${f}: ${n} lines, lower the ceiling ${ceiling} -> ${Math.ceil((n + 1) / 100) * 100}`;
      });
    expect(stale, 'The ratchet only holds if ceilings follow the files down.').toEqual([]);
  });
});
