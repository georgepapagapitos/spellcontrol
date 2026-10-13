// @vitest-environment node
//
// E1006: the generic "target missed" channel, over the same real-card fixtures
// as the invariant checker it reads.
import { beforeAll, describe, expect, it } from 'vitest';
import { checkDeckInvariants } from './deckInvariants';
import {
  computeTargetMisses,
  describeTargetMiss,
  poolExhaustionCause,
  TARGET_OF_CHECK,
} from './targetMisses';
import {
  assemble,
  card,
  cleanCategories,
  context,
  customization,
  loadTaggerSnapshot,
  swap,
} from './__fixtures__/invariant-deck';

beforeAll(loadTaggerSnapshot);

const miss = (misses: ReturnType<typeof computeTargetMisses>, key: string) =>
  misses.find((m) => m.key === key);

describe('computeTargetMisses', () => {
  it('reports nothing for a deck that hit every number', () => {
    expect(computeTargetMisses(assemble(cleanCategories()), context())).toEqual([]);
  });

  it('names a nonbasic shortfall by the pool when nothing else limited it', () => {
    const m = computeTargetMisses(
      assemble(cleanCategories()),
      context({ customization: customization({ nonBasicLandCount: 8 }) })
    );
    expect(miss(m, 'nonbasic')).toEqual({
      key: 'nonbasic',
      asked: 8,
      got: 3,
      cause: 'no other fitting land for this deck',
    });
  });

  it('does not blame the budget just because one is set', () => {
    const m = computeTargetMisses(
      assemble(cleanCategories()),
      context({ customization: customization({ nonBasicLandCount: 8, deckBudget: 5000 }) })
    );
    expect(miss(m, 'nonbasic')?.cause).toBe('no other fitting land for this deck');
  });

  it('blames a price limit only when one was set', () => {
    const m = computeTargetMisses(
      assemble(cleanCategories()),
      context({ customization: customization({ nonBasicLandCount: 8, maxCardPrice: 1 }) })
    );
    expect(miss(m, 'nonbasic')?.cause).toBe('no fitting land under the price limit');
  });

  it('blames the coherence repair that swapped a nonbasic for a basic', () => {
    const cats = cleanCategories();
    swap(cats, "Karn's Bastion", card('Forest'));
    const deck = assemble(cats, {
      coherenceRepairs: [{ cut: "Karn's Bastion", added: 'Forest', reason: 'colorless utility' }],
    });
    expect(miss(computeTargetMisses(deck, context()), 'nonbasic')).toMatchObject({
      asked: 3,
      got: 2,
      cause: 'the deck check swapped a land that does not fit for a basic',
    });
  });

  it('blames the collection only for an owned-only build', () => {
    const cz = (collectionStrategy: 'full' | 'prefer') =>
      customization({ nonBasicLandCount: 8, collectionStrategy });
    const owned = new Set(['Command Tower']);
    const only = computeTargetMisses(
      assemble(cleanCategories()),
      context({ customization: cz('full'), collectionNames: owned })
    );
    expect(miss(only, 'nonbasic')?.cause).toBe('no other fitting land in your collection');
    const prefer = computeTargetMisses(
      assemble(cleanCategories()),
      context({ customization: cz('prefer'), collectionNames: owned })
    );
    expect(miss(prefer, 'nonbasic')?.cause).toBe('no other fitting land for this deck');
  });

  it('reports a typed land count the deck did not reach', () => {
    const typed = computeTargetMisses(
      assemble(cleanCategories()),
      context({ customization: customization({ landCount: 40 }) })
    );
    expect(miss(typed, 'lands')).toMatchObject({ asked: 40, got: 64 });
  });

  it('holds an untouched land count to the generator plan, not the store default', () => {
    const base = assemble(cleanCategories());
    const deck = { ...base, composition: { ...base.composition!, lands: 62 } };
    const m = computeTargetMisses(
      deck,
      context({ customization: customization({ landCount: 37, nonBasicLandCount: 15 }) })
    );
    expect(miss(m, 'lands')).toMatchObject({ asked: 62, got: 64 });
  });

  it('reports a blown budget with its currency', () => {
    const m = computeTargetMisses(
      assemble(cleanCategories()),
      context({ customization: customization({ deckBudget: 20 }) })
    );
    const b = miss(m, 'budget');
    expect(b).toMatchObject({ asked: 20, currency: 'USD', cause: null });
    expect(b!.got).toBeGreaterThan(21);
  });

  it('gives a blown budget the reason the converge recorded', () => {
    const m = computeTargetMisses(
      assemble(cleanCategories()),
      context({ customization: customization({ deckBudget: 20 }) }),
      {
        budgetResidualReason:
          'no cheaper alternative for the remaining cards. 2 cards have no price data',
      }
    );
    expect(miss(m, 'budget')?.cause).toBe('no cheaper alternative for the remaining cards');
  });

  it('falls back to the pool that limited a blown budget', () => {
    const m = computeTargetMisses(
      assemble(cleanCategories()),
      context({ customization: customization({ deckBudget: 20, scryfallQuery: 't:elf' }) })
    );
    expect(miss(m, 'budget')?.cause).toBe('your Scryfall filter has no cheaper card that fits');
  });

  it('reports a partial owned share that fell short', () => {
    const m = computeTargetMisses(
      assemble(cleanCategories()),
      context({
        customization: customization({
          collectionStrategy: 'partial',
          collectionOwnedPercent: 50,
        }),
        collectionNames: new Set(['Brainstorm']),
      })
    );
    const o = miss(m, 'owned');
    expect(o?.asked).toBe(50);
    expect(o!.got).toBeLessThan(45);
  });
});

describe('every user-target invariant has a targetMisses entry', () => {
  it('maps exactly the four typed targets', () => {
    const mapped = Object.values(TARGET_OF_CHECK).filter((k) => k !== null);
    expect([...mapped].sort()).toEqual(['budget', 'lands', 'nonbasic', 'owned']);
  });

  it('turns each mapped check a deck trips into an entry of that key', () => {
    const cz = customization({
      landCount: 40,
      nonBasicLandCount: 8,
      deckBudget: 20,
      collectionStrategy: 'partial',
      collectionOwnedPercent: 50,
    });
    const ctx = context({ customization: cz, collectionNames: new Set(['Brainstorm']) });
    const deck = assemble(cleanCategories());
    const tripped = new Set(checkDeckInvariants(deck, ctx).map((v) => TARGET_OF_CHECK[v.check]));
    tripped.delete(null);
    expect([...tripped].sort()).toEqual(['budget', 'lands', 'nonbasic', 'owned']);
    const keys = computeTargetMisses(deck, ctx).map((m) => m.key);
    expect(keys.sort()).toEqual(['budget', 'lands', 'nonbasic', 'owned']);
  });
});

describe('poolExhaustionCause', () => {
  it('blames the collection only when it constrains the build', () => {
    expect(poolExhaustionCause({ collectionConstrains: true, hasScryfallQuery: false })).toBe(
      'your collection'
    );
    expect(poolExhaustionCause({ collectionConstrains: false, hasScryfallQuery: true })).toBe(
      'your Scryfall filter'
    );
  });
});

describe('describeTargetMiss', () => {
  it('reads as one sentence with its cause', () => {
    expect(
      describeTargetMiss({
        key: 'nonbasic',
        asked: 11,
        got: 8,
        cause: 'no fitting land under the budget',
      })
    ).toBe('Asked for 11 nonbasic lands, got 8: no fitting land under the budget.');
    expect(
      describeTargetMiss({ key: 'budget', asked: 75, got: 90.5, cause: null, currency: 'USD' })
    ).toBe('Budget of $75.00, deck costs $90.50.');
  });
});
