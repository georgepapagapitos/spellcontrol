/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Coach → "Browse all EDHREC suggestions" is a grid of tiles. Its cells were
// top-aligned at their own height, so a tile whose meta line or chips wrapped
// stood taller than its neighbors and every row came out ragged (Add buttons
// at different heights, gaps under the short tiles). The name also shared a
// line with the role/Owned chips, which truncated it and moved the chips from
// line one to line two tile by tile.
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'deck-builder-analysis-panel.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
);
const tsx = readFileSync(join(here, '../components/deck/DeckAnalysisPanel.tsx'), 'utf8');

function ruleBody(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} rule is missing`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
}

describe('EDHREC suggestion grid', () => {
  it('gives every tile the same height and stretches it to fill its cell', () => {
    const list = ruleBody('.deck-analysis-suggest-list');
    expect(list).toMatch(/grid-auto-rows:\s*1fr/);
    expect(list).not.toMatch(/align-items:\s*start/);
  });

  it('puts the name on its own line, with the chips on a separate one', () => {
    expect(tsx).not.toContain('deck-analysis-suggest-title-row');
    expect(tsx).toContain('deck-analysis-suggest-chips');
    expect(ruleBody('.deck-analysis-suggest-chips')).toMatch(/flex-wrap:\s*wrap/);
  });
});
