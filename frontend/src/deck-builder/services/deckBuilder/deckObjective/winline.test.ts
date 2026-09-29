// @vitest-environment node
//
// Win lines over real cards (terms/winline.ts): finishers and win combos,
// timed together by the assembly clock.
import { describe, expect, it } from 'vitest';
import { NO_WIN, winLines, winlineTerm } from './terms/winline';
import { BASELINE, FIX, MEREN, card, cards, merenCtx, swap } from './__fixtures__/objectiveFixture';

describe('win lines', () => {
  const combo = FIX.hermitDruidCombo;
  // Meren's real 99 with the Hermit Druid line over two filler slots.
  const withLine = swap(
    swap(BASELINE, 'Dread Return', 'Hermit Druid'),
    'Life // Death',
    "Thassa's Oracle"
  );
  const ctx = merenCtx({ combos: [...FIX.meren.combos, combo] });

  it('reads finishers from card facts and names them', () => {
    const deck = swap(BASELINE, 'Dread Return', 'Exsanguinate');
    expect(winLines(deck, merenCtx()).finishers).toContain('Exsanguinate');
    const v = winlineTerm(deck, merenCtx());
    expect(v.value).toBeGreaterThan(0);
    const names = new Set([MEREN.name, ...deck.cards.map((c) => c.name)]);
    for (const c of v.cards) expect(names.has(c.name), c.name).toBe(true);
  });

  it('counts a complete win combo as a line, and cutting its finisher registers', () => {
    const lines = winLines(withLine, ctx);
    expect(lines.combos.some((c) => c.includes('Hermit Druid'))).toBe(true);
    expect(lines.finishers).toContain("Thassa's Oracle");
    const whole = winlineTerm(withLine, ctx).value;
    const broken = winlineTerm(swap(withLine, "Thassa's Oracle", 'Swamp'), ctx).value;
    expect(whole).toBeGreaterThan(broken);
  });

  it("losing the deck's only finisher costs the whole line", () => {
    const krenko = card('Krenko, Mob Boss');
    const filler = cards(
      'Mountain',
      'Mountain',
      'Mountain',
      'Goblin Instigator',
      'Mogg War Marshal'
    );
    const hoof = { commanders: [krenko], cards: [...filler, card('Craterhoof Behemoth')] };
    const none = { commanders: [krenko], cards: [...filler, card('Mountain')] };
    const c = merenCtx({ colorIdentity: ['R', 'G'] });
    expect(winLines(hoof, c).finishers).toContain('Craterhoof Behemoth');
    expect(winlineTerm(hoof, c).value).toBeGreaterThan(winlineTerm(none, c).value);
  });

  it('a deck with no way to win reads a penalty and says so', () => {
    const pile = { commanders: [card('Sol Ring')], cards: cards('Arcane Signet', 'Swamp') };
    const v = winlineTerm(pile, merenCtx());
    expect(v.value).toBe(-NO_WIN);
    expect(v.cards[0].note).toMatch(/nothing in the deck ends the game/);
  });
});
