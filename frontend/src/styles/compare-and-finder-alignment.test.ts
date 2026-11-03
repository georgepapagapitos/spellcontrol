/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

/** The declaration block of the first rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return m ? m[1] : '';
}

describe('DK-04: deck compare page sits on the shell axis', () => {
  const css = read('../pages/DeckComparePage.css');

  it('fills the shell frame instead of a narrower left-hugging box', () => {
    const block = rule(css, '.deck-compare-page');
    expect(block).not.toMatch(/max-width/);
    expect(block).not.toMatch(/margin(-inline)?:[^;]*auto/);
  });
});

describe('DK-06: commander finder Color label is top-aligned', () => {
  const css = read('../components/deck/CommanderSearch.css');
  const tsx = read('../components/deck/CommanderSearch.tsx');

  it('top-aligns only the stacked Color row, not every finder row', () => {
    expect(rule(css, '.commander-finder-row')).toMatch(/align-items:\s*center/);
    expect(rule(css, '.commander-finder-row.is-stacked')).toMatch(/align-items:\s*start/);
  });

  it('gives the stacked label one swatch of height so it centers on the swatch line', () => {
    expect(rule(css, '.commander-finder-row.is-stacked .commander-finder-label')).toMatch(
      /min-height:\s*2rem/
    );
  });

  it('marks the Color row, and only that row, as stacked', () => {
    const stacked = tsx.match(/commander-finder-row is-stacked/g) ?? [];
    expect(stacked).toHaveLength(1);
    expect(tsx).toMatch(
      /commander-finder-row is-stacked">\s*<span className="commander-finder-label" id=\{`\$\{baseId\}-colors`\}/
    );
  });
});
