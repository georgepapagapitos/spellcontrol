/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// A page's loading state holds the whole viewport. A shorter one paints the
// footer mid-screen on desktop, then shoves it off when the content lands.
// `.shared-view--loading` (every public share page: /d/, /s/, /b/, /l/ and the
// shared playtest) sat at 60vh: CLS 0.14 on /d/:id and 0.10 on
// /d/:id/playtest, where production passed on 70% and 50% of visits (E1049).
// Fix: `min-height: 100dvh` in the class's own rule, as `.page-loader` has.

const here = dirname(fileURLToPath(import.meta.url));

/** Declarations of every rule whose selector list includes `selector` exactly. */
function decls(file: string, selector: string): string {
  const css = readFileSync(join(here, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '';
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // Whole text first: a `:has(a, b)` selector has a comma of its own.
    const sel = m[1].trim();
    if (sel === selector || sel.split(',').some((s) => s.trim() === selector)) out += m[2];
  }
  return out;
}

describe('page loading states hold the viewport', () => {
  it.each([
    ['feedback-spinner.css', '.page-loader'],
    ['shared.css', '.shared-view--loading'],
  ])('%s %s', (file, selector) => {
    const body = decls(file, selector);
    const heights = [...body.matchAll(/min-height:\s*([^;]+);/g)].map((m) => m[1].trim());
    // The last declaration wins in source order.
    expect(heights.at(-1)).toBe('100dvh');
  });
});

// A fixed full-screen board leaves the page under it empty, so the footer
// rose to the top behind the board once the loader gave way (CLS 0.06 to
// 0.10 on desktop /d/:id/playtest, E1049). Under the board it leaves the layout.
describe('a full-screen playtest board leaves no footer behind it', () => {
  it('playtest.css hides the footer while the board is up', () => {
    const body = decls('playtest.css', 'body:has(.playtest-page, .horde-table-page) .footer');
    expect(body).toMatch(/display:\s*none/);
  });
});
