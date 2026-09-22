/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(srcRoot, p), 'utf8');

/**
 * Guard: the icon-font stylesheets stay OFF the critical path.
 *
 * mana-font + keyrune were 13.7 KB gzipped of the render-blocking payload on
 * 2026-09-22 — the two largest stylesheets in it, larger than any of the app's
 * own, and neither one ours. They define a class for every mana symbol and
 * every set symbol ever printed, none of which the first paint needs. Moving
 * them into a dynamic import took the boot CSS from 79 KB to 65 and the
 * headroom under the budget from 0.4 KB to 15.
 *
 * Adding `import 'mana-font/css/mana.min.css'` back to main.tsx would undo all
 * of that in one line, and nothing else would notice until the budget tripped
 * on some unrelated PR. Three things have to hold:
 *
 *  1. main.tsx does not statically import either vendor sheet, or our
 *     @font-face overrides that must stay with them.
 *  2. They travel TOGETHER, in order: `icon-fonts.css` re-points the vendor
 *     @font-face rules at the bbox-corrected woff2 builds and only wins by
 *     coming later in the cascade. Deferring the vendor pair while leaving
 *     ours in the entry puts the vendor rules last and hands back the broken
 *     fonts (~940 Firefox `glyf` warnings a page load, and twice the download).
 *  3. The glyph box is reserved while the sheet is in flight, or every symbol
 *     pops from zero width at once and shifts the text beside it.
 */
describe('icon fonts stay off the critical path', () => {
  const main = read('main.tsx');

  it('main.tsx never statically imports the glyph stylesheets', () => {
    for (const sheet of ['mana-font/css', 'keyrune/css', './styles/icon-fonts.css']) {
      expect(
        main.includes(`import '${sheet}`),
        `main.tsx statically imports ${sheet} — that is 13.7 KB of render-blocking CSS the first paint does not use`
      ).toBe(false);
    }
  });

  it('loads them as one dynamic import instead', () => {
    expect(main).toMatch(/import\('\.\/styles\/icon-fonts-async'\)/);
  });

  it('keeps the vendor sheets and our @font-face overrides together, in order', () => {
    const async_ = read('styles/icon-fonts-async.ts');
    const order = ['mana-font/css', 'keyrune/css', './icon-fonts.css'].map((s) =>
      async_.indexOf(s)
    );
    expect(
      order.every((i) => i > -1),
      'a sheet went missing from the deferred bundle'
    ).toBe(true);
    expect(
      [...order].sort((a, b) => a - b),
      'icon-fonts.css must come LAST — it only overrides the vendor @font-face by cascade order'
    ).toEqual(order);
  });

  it('reserves the glyph box while the sheet is in flight, and gives it back', () => {
    expect(main).toMatch(/classList\.add\('icons-pending'\)/);
    expect(
      main,
      'the reservation must be dropped when the import resolves, or it fights the real glyph metrics'
    ).toMatch(/classList\.remove\('icons-pending'\)/);
    expect(read('styles/base-layout.css')).toMatch(/\.icons-pending \.ms[\s\S]{0,80}width: 1em/);
  });
});
