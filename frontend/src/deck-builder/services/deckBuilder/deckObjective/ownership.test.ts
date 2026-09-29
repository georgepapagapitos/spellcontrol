// @vitest-environment node
//
// The ownership term over real cards and real prices (terms/ownership.ts):
// the E509 ruling's price bar, and the "Lean on mine" owned bonus.
import { describe, expect, it } from 'vitest';
import {
  LAND_BAR_BASE,
  OWNED_BONUS,
  buyBar,
  ownershipTerm,
  priceDoublings,
} from './terms/ownership';
import { checkConstraints } from './constraints';
import { card, merenCtx, merenDeck } from './__fixtures__/objectiveFixture';

const DECK = merenDeck(['Sol Ring', 'Vampiric Tutor', 'Swamp', 'Skullclamp']);
const price = (name: string) => parseFloat(card(name).prices.usd ?? '0');
const ctxFor = (customization: Record<string, unknown>, owned: string[]) =>
  merenCtx({
    customization: { currency: 'USD', collectionMode: true, ...customization },
    ownedNames: new Set(owned),
  });

describe('ownership', () => {
  it('is zero without a collection', () => {
    expect(ownershipTerm(DECK, merenCtx()).value).toBe(0);
  });

  it('charges each unowned card the ruling bar, owned cards and basics nothing', () => {
    const ctx = ctxFor({ collectionStrategy: 'partial', collectionOwnedPercent: 50 }, [
      'Sol Ring',
      'Skullclamp',
    ]);
    const v = ownershipTerm(DECK, ctx);
    const tutor = card('Vampiric Tutor');
    expect(v.value).toBeCloseTo(-buyBar(tutor, price('Vampiric Tutor')));
    expect(v.cards.map((c) => c.name)).toEqual(['Vampiric Tutor']);
    expect(v.cards[0].note).toMatch(/^buy for \d+\.\d\d USD: [\d.]+ price doublings$/);
  });

  it('raises the bar one step per price doubling past $2, lands from a base', () => {
    expect(priceDoublings(2)).toBeCloseTo(1);
    expect(priceDoublings(0)).toBe(0);
    const spell = card('Sol Ring');
    const land = card('Command Tower');
    expect(buyBar(spell, 6) - buyBar(spell, 2)).toBeCloseTo(buyBar(spell, 2));
    expect(buyBar(land, 0)).toBe(LAND_BAR_BASE);
    // A $1 staple costs a buyer about a twentieth of a card.
    expect(buyBar(spell, 1)).toBeLessThan(0.06);
  });

  it('"Lean on mine" credits owned cards', () => {
    const ctx = ctxFor({ collectionStrategy: 'prefer' }, ['Skullclamp']);
    const v = ownershipTerm(DECK, ctx);
    expect(v.cards.find((c) => c.name === 'Skullclamp')!.value).toBe(OWNED_BONUS);
    expect(v.cards.find((c) => c.name === 'Sol Ring')!.value).toBeLessThan(0);
  });

  it('holds an N% owned share exactly, and a must-include may break it', () => {
    const spells = merenDeck(['Sol Ring', 'Vampiric Tutor', 'Skullclamp', 'Grave Pact']);
    const share = (owned: string[], must: string[] = []) =>
      checkConstraints(
        spells,
        ctxFor(
          { collectionStrategy: 'partial', collectionOwnedPercent: 50, mustIncludeCards: must },
          owned
        )
      ).filter((v) => v.check === 'owned-share');
    expect(share(['Sol Ring', 'Skullclamp'])).toEqual([]);
    expect(share(['Sol Ring'])).toEqual([expect.objectContaining({ magnitude: 1 })]);
    expect(share(['Sol Ring'], ['Grave Pact'])).toEqual([]);
  });
});
