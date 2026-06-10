/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// UX-105 guard: the spacing language is a fixed 4px-base scale defined once in
// global.css (see STYLE_GUIDE.md § Color & spacing). New code spaces with
// `var(--space-N)` instead of freehand rems; this test fails loudly if a scale
// step's definition goes missing.
//
// CSS `?raw` imports come back empty under this vite/rolldown setup, so read
// the stylesheet off disk (tests run in the node env per vitest.config.ts).
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('spacing tokens (UX-105)', () => {
  const globalCss = readFileSync(join(srcRoot, 'styles', 'global.css'), 'utf8');

  it('defines all eight --space-* scale steps in global.css', () => {
    for (const token of [
      '--space-1',
      '--space-2',
      '--space-3',
      '--space-4',
      '--space-5',
      '--space-6',
      '--space-7',
      '--space-8',
    ]) {
      expect(
        new RegExp(`${token}\\s*:`).test(globalCss),
        `${token} should be defined in global.css`
      ).toBe(true);
    }
  });
});
