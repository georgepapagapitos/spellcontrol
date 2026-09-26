// @vitest-environment node
//
// Guard (E406): a test that renders never resets its mocks in afterEach.
//
// Vitest runs afterEach hooks in reverse order of registration, so a file's own
// afterEach runs BEFORE Testing Library's cleanup: the page is still mounted
// when `mockReset()` wipes the mocks' return values. A test that ends as soon
// as its text appears can leave an effect unflushed (async waits run outside
// act, and the scheduler's task races the drain), and under CI load that
// effect fires in the gap, calls the reset mock, gets `undefined`, and throws
// `Cannot read properties of undefined (reading 'then')` into whichever test
// is running. PublicProfilePage's owner test failed that way on CI twice.
//
// Reset in beforeEach instead: nothing is mounted then, and a late effect in
// any test sees that test's own mocks.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const selfPath = fileURLToPath(import.meta.url);
const srcDir = resolve(dirname(selfPath), '..');

function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) testFiles(full, out);
    else if (/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every `afterEach(...)` call, found by matching its own parentheses (an
 *  arrow with no braces, `afterEach(() => x())`, ends at its `)`). */
function afterEachBodies(src: string): { body: string; at: number }[] {
  const out: { body: string; at: number }[] = [];
  for (let i = src.indexOf('afterEach('); i !== -1; i = src.indexOf('afterEach(', i + 1)) {
    const open = i + 'afterEach'.length;
    let depth = 0;
    let end = open;
    for (; end < src.length; end++) {
      if (src[end] === '(') depth++;
      else if (src[end] === ')' && --depth === 0) break;
    }
    out.push({ body: src.slice(open, end + 1), at: i });
  }
  return out;
}

const RESET = /\.mockReset\(|vi\.resetAllMocks\(/;

describe('mocks are reset before a render, never after it', () => {
  it('no test that renders calls mockReset or vi.resetAllMocks in afterEach', () => {
    const offenders: string[] = [];
    for (const file of testFiles(srcDir)) {
      if (file === selfPath) continue; // this guard spells the pattern out on purpose
      const src = readFileSync(file, 'utf8');
      if (!src.includes('@testing-library/react')) continue;
      for (const { body, at } of afterEachBodies(src)) {
        if (RESET.test(body)) {
          const line = src.slice(0, at).split('\n').length;
          offenders.push(`${file.slice(srcDir.length + 1).replaceAll('\\', '/')}:${line}`);
        }
      }
    }
    expect(
      offenders,
      `These tests reset mocks in afterEach, while the page is still mounted (the file's ` +
        `afterEach runs before Testing Library's cleanup). A late effect then calls a mock ` +
        `with no return value. Move the reset to the start of a beforeEach.\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });
});
