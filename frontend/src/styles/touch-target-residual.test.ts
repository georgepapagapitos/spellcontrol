/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * E1000: the corrected hit-census (ancestor hits no longer count) found these
 * controls under the floor at phone tier. Each keeps its visible size and gets
 * a coarse-pointer ::after ghost; these pin the ghost so it cannot be dropped.
 */
describe('E1000 residual touch targets', () => {
  it('the deck-analysis suggest-add chip has a 44px coarse ghost', () => {
    const css = read('deck-builder-analysis-panel.css');
    expect(css).toMatch(/\.deck-analysis-suggest-add::after\s*\{[^}]*inset:\s*-7px 0/);
  });

  it('the commander color pip ghost reaches 44px on the inline axis too', () => {
    const css = read('deck-builder-commander.css');
    const m = css.match(/\.commander-color-pip::after\s*\{([^}]*)\}/);
    expect(m, 'pip ghost missing').toBeTruthy();
    expect(m![1]).toMatch(/left:\s*-2px/);
    expect(m![1]).toMatch(/width:\s*calc\(100% \+ 4px\)/);
    expect(m![1]).toMatch(/height:\s*44px/);
  });

  /**
   * The second half of E1000, from the nightly's hit-walk (elementFromPoint,
   * not the CSS): each of these read under 44 in a real phone run. The journey
   * now fails on any new one; these pin the specific fixes.
   */
  it('the deck section collapse ghost clears the icon and the row beside it', () => {
    const css = read('deck-builder-card-list.css');
    expect(css).toMatch(/\.deck-section-collapse\s*\{[^}]*z-index:\s*1/);
    expect(css).toMatch(/\.deck-section-collapse::after\s*\{[^}]*top:\s*calc\(50% - 3px\)/);
  });

  it('inline text buttons and links take the shared .text-link ghost, not a copy', () => {
    // The nightly phone walk read "Fit & cut" 57x27 and a context pill 121x42.
    // `.text-link::after` is the one 44px ghost for a control inside a line of
    // text; the duplicate-block ratchet refuses a second copy of it.
    const src = (f: string) => readFileSync(join(here, f), 'utf8');
    const panel = src('../components/deck/CardSearchPanel.tsx');
    expect(panel).toContain("'card-search-fit text-link'");
    expect(panel).not.toMatch(/className="card-search-fit"/);
    const preview = src('../components/card/CardPreview.tsx');
    const pills = preview.match(/className="card-preview-context-pill[^"]*"/g) ?? [];
    expect(pills.length).toBeGreaterThan(0);
    for (const c of pills) expect(c).toContain('text-link');
  });

  it('the card preview context row and pills reach 44 on touch', () => {
    const css = read('footer-card-preview.css');
    expect(css).toMatch(/\.card-preview-context\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.card-preview-ext-link::after\s*\{[^}]*inset:\s*-9px -6px/);
  });

  it('the combo Add and details toggle, the keyword head and the footer links take the floor', () => {
    expect(read('deck-builder-combos-list.css')).toMatch(
      /\.deck-combos-details-toggle,\s*\.deck-combos-add\s*\{[^}]*min-height:\s*44px/
    );
    expect(read('../components/rules/RulesReference.css')).toMatch(
      /\.rules-ref-keyword-head\s*\{[^}]*min-height:\s*44px/
    );
    expect(read('../components/deck/BuildReportSheet.css')).toMatch(
      /\.build-report-sheet-close\s*\{[^}]*min-height:\s*44px/
    );
    expect(read('../pages/WelcomePage.css')).toMatch(
      /\.welcome-footer a\s*\{[^}]*min-height:\s*44px/
    );
  });
});
