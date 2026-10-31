import { describe, it, expect } from 'vitest';
import { HIGH_LIFT_POOL_MIN_INCLUSION, parseEdhrecResponse } from './client';
import page from './__fixtures__/commander-page-sythis-highlift.fixture.json';

// Real Sythis page (2026-10-31). EDHREC lists a commander's high-lift cards
// ONLY under `highliftcards`, never in a type list, so a parser that skips the
// tag drops them from the generator pool (Seal of Primordium 40%, Seal of
// Cleansing 44%). Cards under the floor stay out: ~5% lift cards displaced
// 23-33% staples on Talrand when every one was routed in.
describe('parseEdhrecResponse: highliftcards above an inclusion floor', () => {
  const { allNonLand } = parseEdhrecResponse(page, 'sythis-harvests-hand').cardlists;
  const byName = new Map(allNonLand.map((c) => [c.name, c]));

  it('routes cards at or above the floor into the pool with their stats', () => {
    for (const name of ['Seal of Cleansing', 'Seal of Primordium', 'Whip Silk']) {
      const card = byName.get(name);
      expect(card, name).toBeDefined();
      expect(card!.inclusion).toBeGreaterThanOrEqual(HIGH_LIFT_POOL_MIN_INCLUSION);
      expect(card!.synergy).toBeGreaterThan(0);
    }
  });

  it('does not flag them as theme synergy cards', () => {
    expect(byName.get('Seal of Cleansing')!.isThemeSynergyCard).toBeFalsy();
  });

  it('leaves cards below the floor out of the pool', () => {
    expect(byName.has('Mana Bloom')).toBe(false); // 6%
    expect(byName.has('Seam Rip')).toBe(false); // 6%
  });
});
