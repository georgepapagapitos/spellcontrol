// The nightly journey's touchingSiblings check flags two boxed siblings that
// meet edge to edge. A divided stack (rows split by one hairline) meets by
// design and is exempted by parent in TOUCHING_BY_DESIGN_PARENTS in
// scripts/journey.mjs. #2975 turned the new-deck doors into such a stack and
// left that list alone, so the nightly went red on /decks/new for three runs
// (E1066). This asserts the exemption and the CSS that justifies it stay in
// step, so a stack cannot be added or changed without the other.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const journey = readFileSync(resolve(root, 'scripts/journey.mjs'), 'utf8');
const doorsCss = readFileSync(resolve(root, 'frontend/src/pages/DeckNewPage.css'), 'utf8');

const exemptParents = (() => {
  const m = journey.match(/const TOUCHING_BY_DESIGN_PARENTS = \[([\s\S]*?)\n\];/);
  if (!m) throw new Error('TOUCHING_BY_DESIGN_PARENTS not found in scripts/journey.mjs');
  return [...m[1].replace(/\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map((x) => x[1]);
})();

describe('journey touching-siblings exemptions', () => {
  it('exempts the new-deck doors, a hairline-divided stack', () => {
    expect(exemptParents).toContain('div.deck-new-doors');
  });

  it('keeps the doors a divided stack: hairline rows, no gap', () => {
    const door = doorsCss.match(/\.deck-new-door \{([^}]*)\}/)?.[1] ?? '';
    expect(door).toMatch(/border-bottom:\s*0\.5px solid/);
    const stack = doorsCss.match(/\.deck-new-doors \{([^}]*)\}/)?.[1] ?? '';
    expect(stack).not.toMatch(/\bgap:/);
  });
});
