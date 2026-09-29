// @vitest-environment node
//
// The ownership term over real cards and real prices (terms/ownership.ts).
import { describe, expect, it } from 'vitest';
import {
  DOLLARS_OWNED_ONLY,
  DOLLARS_PREFER,
  OWNED_BONUS,
  dollarsPerCard,
  ownershipTerm,
} from './terms/ownership';
import { card, merenCtx, merenDeck } from './__fixtures__/objectiveFixture';

const DECK = merenDeck(['Sol Ring', 'Vampiric Tutor', 'Swamp', 'Skullclamp']);
const price = (name: string) => parseFloat(card(name).prices.usd ?? '0');
const ctxFor = (customization: Record<string, unknown>, owned: string[]) =>
  merenCtx({ customization: { currency: 'USD', ...customization }, ownedNames: new Set(owned) });

describe('ownership', () => {
  it('is zero without a collection', () => {
    expect(ownershipTerm(DECK, merenCtx()).value).toBe(0);
    expect(dollarsPerCard(merenCtx())).toBeNull();
  });

  it('charges unowned cards at the owned-only rate, owned cards and basics nothing', () => {
    const ctx = ctxFor({ collectionMode: true, collectionStrategy: 'full' }, [
      'Sol Ring',
      'Skullclamp',
    ]);
    const v = ownershipTerm(DECK, ctx);
    expect(v.value).toBeCloseTo(-price('Vampiric Tutor') / DOLLARS_OWNED_ONLY);
    expect(v.cards.map((c) => c.name)).toEqual(['Vampiric Tutor']);
    expect(v.cards[0].note).toMatch(/^buy for \d+\.\d\d USD$/);
  });

  it('a lower owned share tolerates buying more readily', () => {
    const p100 = ctxFor(
      { collectionMode: true, collectionStrategy: 'partial', collectionOwnedPercent: 100 },
      []
    );
    const p50 = ctxFor(
      { collectionMode: true, collectionStrategy: 'partial', collectionOwnedPercent: 50 },
      []
    );
    expect(dollarsPerCard(p50)).toBeCloseTo(2 * dollarsPerCard(p100)!);
    expect(ownershipTerm(DECK, p50).value).toBeGreaterThan(ownershipTerm(DECK, p100).value);
  });

  it('"Lean on mine" credits owned cards and prices purchases gently', () => {
    const ctx = ctxFor({ collectionMode: true, collectionStrategy: 'prefer' }, ['Skullclamp']);
    const v = ownershipTerm(DECK, ctx);
    const skull = v.cards.find((c) => c.name === 'Skullclamp')!;
    expect(skull.value).toBe(OWNED_BONUS);
    expect(v.cards.find((c) => c.name === 'Sol Ring')!.value).toBeCloseTo(
      -price('Sol Ring') / DOLLARS_PREFER
    );
    // A $1-2 staple costs at most a tenth of a card for any user who allows buying.
    expect(price('Sol Ring') / DOLLARS_PREFER).toBeLessThan(0.1);
  });

  it('a deck budget caps the rate at a tenth of the budget', () => {
    const ctx = ctxFor({ collectionMode: true, collectionStrategy: 'prefer', deckBudget: 50 }, []);
    expect(dollarsPerCard(ctx)).toBe(5);
  });
});
