/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// T135 guard: STYLE_GUIDE § Layout system, "Density tiers: phone ≤599 ·
// tablet 600–1023 · desktop ≥1024 … driven by tier tokens rather than
// per-component media queries". tokens.css sets --control-h and --gutter per
// tier, with a coarse pointer flooring --control-h at 44px last. The shared
// controls, the page gutter and the desktop header read those tokens, so a
// tier is one edit and a control can't fall under the touch floor by the
// order its stylesheet declares its rules in (the tablet banner button that
// read 40px on touch while the floor was a separate rule).
const styles = join(dirname(fileURLToPath(import.meta.url)));
const src = join(styles, '..');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const read = (f: string) => strip(readFileSync(join(styles, f), 'utf8'));
const readSrc = (f: string) => strip(readFileSync(join(src, f), 'utf8'));

/** The declarations of every rule whose selector list includes `selector`. */
function decls(css: string, selector: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    if (m[1].split(',').some((s) => s.trim() === selector)) out.push(m[2]);
  return out.join(';');
}

describe('density tiers (T135)', () => {
  const tokens = read('tokens.css');

  it('sets each tier and floors a touch pointer last', () => {
    const tablet = tokens.indexOf('@media (max-width: 1023px)');
    const phone = tokens.indexOf('@media (max-width: 599px)', tablet);
    const coarse = tokens.lastIndexOf('@media (pointer: coarse)');
    expect(tablet).toBeGreaterThan(0);
    expect(phone).toBeGreaterThan(tablet);
    expect(coarse).toBeGreaterThan(phone);
    expect(tokens.slice(tablet, phone)).toMatch(/--control-h:\s*2\.5rem/);
    expect(tokens.slice(phone, coarse)).toMatch(/--control-h:\s*2\.75rem/);
    expect(tokens.slice(phone, coarse)).toMatch(/--text-base:\s*1rem/);
    expect(tokens.slice(coarse)).toMatch(/--control-h:\s*2\.75rem/);
  });

  it.each([
    ['tabs.css', '.btn', 'min-height'],
    ['tabs.css', '.tab', 'min-height'],
    ['binder-hero.css', '.pill-btn', 'min-height'],
    ['deck-builder-display.css', '.toolbar-pill', 'height'],
    ['search-controls.css', '.search-pill', 'min-height'],
  ])('%s %s stands at the tier height', (file, selector, prop) => {
    expect(decls(read(file), selector)).toMatch(
      new RegExp(`(^|;)\\s*${prop}:\\s*var\\(--control-h\\)`)
    );
  });

  it('the page gutter and the desktop header read the tier gutter', () => {
    const base = read('base-layout.css');
    expect(decls(base, '.app-main')).toMatch(/--page-gutter:\s*var\(--gutter\)/);
    expect(decls(base, '.site-header')).toMatch(/max\(var\(--gutter\)/);
  });

  // List and menu rows stand at the tier's row height. Long card lists are the
  // density exception (user ruling 2026-09-28, § Layout system): a decklist or
  // the collection table stays 36px at every tier, 15 cards to a phone screen.
  it.each([
    ['components/shared/form.css', '.switch-row'],
    ['pages/SetsPage.css', '.sets-row'],
    ['pages/SetsPage.css', '.set-list-row'],
    ['components/play/GameNights.css', '.game-night-attendee-row'],
    ['components/home/AroundTheTable.css', '.home-table-row'],
    ['components/home/YourCardsCard.css', '.home-your-cards-row'],
    ['styles/stats-breakdown.css', '.collection-insight-row'],
    ['pages/RulesPage.css', '.rules-history-item'],
    ['pages/TagsPage.css', '.tags-row'],
    ['pages/cube/cube.css', '.cube-collab-friend-row'],
    ['styles/deck-builder-card-list.css', '.deck-row-menu-item'],
    ['styles/deck-builder-editor.css', '.deck-editor-overflow-item'],
    ['components/PlanShelfModal.css', '.plan-shelf-row'],
  ])('%s %s stands at the tier row height', (file, selector) => {
    expect(decls(readSrc(file), selector)).toMatch(/(^|;)\s*min-height:\s*var\(--row-h\)/);
  });

  it('long card lists keep their own density, not the tier row', () => {
    expect(decls(read('deck-builder-card-list.css'), '.deck-row')).not.toMatch(/var\(--row-h\)/);
    expect(decls(read('collection.css'), '.collection-table-row')).not.toMatch(/var\(--row-h\)/);
  });
});
