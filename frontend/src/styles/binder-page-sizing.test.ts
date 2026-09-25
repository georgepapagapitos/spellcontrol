/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Guards the binder page sizing that made the pages view unusable on a phone
// and unreadable on a desktop (STYLE_GUIDE § Binder views, § Binder page
// viewer):
//
// - `.grid-9` / `.grid-4` / `.grid-12` were fixed 150 / 112 / 200px wide: 42px
//   pockets on a 1440 screen. A phone override then made the row a 2-up grid,
//   so every one-page section sat in half the row with the other half empty.
//   The page now takes its grid track, and the track floor is 5rem per pocket
//   column, so a pocket is the same size whatever the pocket count.
// - The page viewer's page was 60% opaque over a 60% scrim, so the binder grid
//   behind showed through every empty pocket.

const stylesDir = dirname(fileURLToPath(import.meta.url));
const read = (name: string) =>
  readFileSync(join(stylesDir, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const allCss = readdirSync(stylesDir)
  .filter((f) => f.endsWith('.css'))
  .map((f) => [f, read(f)] as const);

/** Every declaration block whose selector list names `selector` exactly. */
function blocks(css: string, selector: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map((s) => s.trim());
    if (selectors.includes(selector)) out.push(m[2]);
  }
  return out;
}

describe('binder page grid sizing', () => {
  it('no stylesheet gives a page grid a fixed width', () => {
    for (const [file, css] of allCss) {
      for (const sel of ['.grid-4', '.grid-9', '.grid-12']) {
        for (const body of blocks(css, sel)) {
          expect(body, `${file} ${sel}`).not.toMatch(/(^|;|\s)width\s*:\s*\d+(\.\d+)?px/);
        }
      }
    }
  });

  it('the page row is a fluid grid with a clamped per-pocket floor', () => {
    const css = read('binder-grid-slots.css');
    const [row] = blocks(css, '.page-row');
    expect(row).toMatch(
      /grid-template-columns:\s*repeat\(\s*auto-fill,\s*minmax\(\s*min\(\s*100%,\s*var\(--page-min\)\s*\),\s*1fr\s*\)\s*\)/
    );
    // 5rem per pocket column: 2, 3 and 4 columns.
    expect(row).toMatch(/--page-min:\s*15rem/);
    expect(blocks(css, '.page-row--p4')[0]).toMatch(/--page-min:\s*10rem/);
    expect(blocks(css, '.page-row--p12')[0]).toMatch(/--page-min:\s*20rem/);
  });

  it('only binder-grid-slots.css lays out the page row', () => {
    for (const [file, css] of allCss) {
      if (file === 'binder-grid-slots.css') continue;
      expect(blocks(css, '.page-row'), file).toHaveLength(0);
    }
  });
});

describe('binder page viewer surface', () => {
  const css = read('footer-card-preview.css');

  it('the page is opaque', () => {
    const [page] = blocks(css, '.binder-pages-page');
    const bg = page.match(/background:\s*([^;]+);/)?.[1] ?? '';
    expect(bg).not.toMatch(/rgba|\/\s*\d|transparent/);
  });

  it('neighbouring pages recede like the card preview — under a wash, never see-through', () => {
    // An opacity fade let the binder grid behind read through the neighbours.
    for (const sel of ['.binder-pages-slide', '.card-preview-slide']) {
      for (const b of blocks(css, sel)) expect(b, sel).not.toMatch(/(^|;|\s)opacity:/);
    }
    const wash = blocks(css, '.binder-pages-slide::after');
    expect(wash.some((b) => /background:/.test(b))).toBe(true);
    expect(blocks(css, '.card-preview-slide::after')).toEqual(
      expect.arrayContaining([expect.stringMatching(/background:/)])
    );
    expect(blocks(css, '.binder-pages-slide.is-active::after')[0]).toMatch(/opacity:\s*0/);
  });

  // 2026-09-25: a Secret Lair binder's section line ("Artist Series Mark Poole ·
  // Extra Life 2021 · Secret Lair x Arcane Lands · …") is one unbreakable
  // nowrap run. The sheet was a grid with an auto-sized column, and that line's
  // min-content grew the column to 1208px on a 384px phone: the page, the
  // binder name and the scrubber all centered off-screen to the right, so the
  // viewer opened blank. No length in the viewer may come from its content.
  it('no text can size the viewer: positioned layout, fixed-height panel, clamped line', () => {
    const sheet = blocks(css, '.binder-pages-sheet').join(';');
    expect(sheet).not.toMatch(/display:\s*grid|grid-template/);
    const panel = blocks(css, '.binder-pages-panel').join(';');
    expect(panel).toMatch(/position:\s*absolute/);
    expect(panel).toMatch(/height:\s*var\(--bp-panel\)/);
    expect(panel).toMatch(/overflow:\s*hidden/);
    const line = blocks(css, '.binder-pages-context').join(';');
    expect(line).toMatch(/line-clamp:\s*2/);
    expect(line).toMatch(/overflow:\s*hidden/);
    // The page's width is the viewport's arithmetic, not its slide's content.
    expect(blocks(css, '.binder-pages-slide').join(';')).toMatch(/flex:\s*0 0 var\(--bp-page-w\)/);
  });

  it('a dead arrow is hidden, not ghosted', () => {
    // On touch the ghosted disabled "previous" arrow outranked the rule hiding
    // arrows, so page 1 showed a dead left arrow and no right one.
    expect(blocks(css, '.carousel-nav:disabled').join(';')).toMatch(/opacity:\s*0/);
  });
});
