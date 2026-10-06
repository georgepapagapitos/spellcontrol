// Guard (T171 lane M): a misfit is a Cuts-lane row, so a card Coach should
// never cut isn't one. Premium cards (premiumCards.ts) read as misfits on
// pages that barely run them (Fierce Guardianship, The One Ring, Imperial
// Seal), and a card whose role is at or under its target was flagged even
// when it was the owned stand-in Coach had just added to fill that role; the
// next pass then traded it back out. Real cards (Scryfall 2026-09-29).
import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { COACH_CARDS } from './__fixtures__/coach-cards.fixtures';
import { computeMisfits } from './cardFit';
import { premiumNames } from './premiumCards';

const real = (name: string): ScryfallCard => ({ ...COACH_CARDS[name] });
// Off this commander's page: no inclusion, no synergy (two misfit reasons each).
const deck = ['Fierce Guardianship', 'The One Ring', 'Imperial Seal', 'Aetherjacket', 'Crib Swap'];
const flagged = (inputs: Partial<Parameters<typeof computeMisfits>[0]>) =>
  computeMisfits({ cards: deck.map(real), cardInclusionMap: {}, cardSynergyMap: {}, ...inputs })
    .map((m) => m.card.name)
    .sort();

describe('computeMisfits — protected cards (T171)', () => {
  it('flags every off-page card without protection', () => {
    expect(flagged({})).toEqual([...deck].sort());
  });

  it('never flags a premium card', () => {
    const protectedNames = premiumNames(deck.map(real), () => undefined);
    expect(flagged({ protectedNames })).toEqual(['Aetherjacket', 'Crib Swap']);
  });

  it('never flags a card whose role is at or under its target', () => {
    const roleOf = (c: ScryfallCard) =>
      c.name === 'Crib Swap' || c.name === 'Aetherjacket' ? 'removal' : null;
    const at = { roleOf, counts: { removal: 6 }, targets: { removal: 6 } };
    expect(flagged({ roleBalance: at })).toEqual([
      'Fierce Guardianship',
      'Imperial Seal',
      'The One Ring',
    ]);
    // Over target: trimming one leaves the role met, so they read as misfits again.
    const over = { roleOf, counts: { removal: 9 }, targets: { removal: 6 } };
    expect(flagged({ roleBalance: over })).toEqual([...deck].sort());
  });
});
