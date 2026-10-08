/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) =>
  readFileSync(join(src, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Each `@media` prelude in a stylesheet, with the body it wraps. */
function mediaBlocks(css: string): { prelude: string; body: string }[] {
  const out: { prelude: string; body: string }[] = [];
  const re = /@media([^{]*)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = re.lastIndex;
    while (depth && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    out.push({ prelude: m[1], body: css.slice(re.lastIndex, i - 1) });
  }
  return out;
}

/**
 * Rules has a door at every width.
 *
 * The header carries Rules beside Search, but the header is `display: none`
 * below 1024px, and the tab bar has no Rules slot (removed on purpose, July
 * 2026). Rules then lived on the Play hero until 2026-09-19, when that pill was
 * removed as a repeat of the header door, which phones never see. Phones were
 * left with no door but You › Help for three weeks. The phone door is now the
 * Search page's `.search-rules-door`, one tap from the tab bar's Search, and
 * hidden only where the header door is showing.
 */
describe('Rules door at every width', () => {
  it('desktop: the header links /rules, and the header is the mobile shell’s casualty', () => {
    expect(read('components/app-shell/Header.tsx')).toMatch(/to="\/rules"/);
    const hidesHeader = mediaBlocks(read('styles/base-layout.css')).some(
      (b) =>
        /max-width:\s*1023px/.test(b.prelude) &&
        /\.site-header\s*\{[^}]*display:\s*none/.test(b.body)
    );
    expect(hidesHeader).toBe(true);
  });

  it('phone: the tab bar reaches Search, and Search links /rules', () => {
    expect(read('components/app-shell/MobileTabBar.tsx')).toMatch(/to="\/search"/);
    expect(read('pages/SearchPage.tsx')).toMatch(
      /className="search-rules-door"\s+to="\/rules"|to="\/rules"\s+className="search-rules-door"/
    );
  });

  it('the Search door hides only from 1024px, where the header door shows', () => {
    const css = read('pages/SearchPage.css');
    const hides = /\.search-rules-door\s*\{[^}]*display:\s*none/;
    // Never hidden at the top level, where it would vanish on phones too.
    const topLevel = mediaBlocks(css).reduce((rest, b) => rest.replace(b.body, ''), css);
    expect(topLevel).not.toMatch(hides);
    for (const b of mediaBlocks(css).filter((blk) => hides.test(blk.body))) {
      expect(b.prelude).toMatch(/min-width:\s*1024px/);
    }
  });
});
