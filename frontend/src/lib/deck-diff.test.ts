/**
 * Unit tests for the pure deck-diff engine (T22). Asserts on real deltas —
 * card-list add/remove/qty-change, price totals, bracket read-through, and the
 * curve/type/color/size stat deltas over the analyzeDeck engine — not just shape.
 *
 * Tagger role classification is module-cached and primed elsewhere; these tests
 * run with taggerReady=false (role counts aren't asserted beyond the type-based
 * `lands` row, which doesn't need the tagger) so they stay hermetic.
 */
import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck } from '@/store/decks';
import {
  cardKey,
  cardUsd,
  diffDeckBracket,
  diffDeckCards,
  diffDeckPrice,
  diffDeckStats,
  diffDecks,
} from './deck-diff';

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'sf-1',
    oracle_id: 'oid-1',
    name: 'Test Card',
    mana_cost: '{2}{G}',
    cmc: 3,
    type_line: 'Creature — Beast',
    oracle_text: '',
    color_identity: ['G'],
    colors: ['G'],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    collector_number: '1',
    image_uris: { normal: 'https://example.com/img.jpg' },
    legalities: { commander: 'legal' },
    layout: 'normal',
    prices: { usd: '1.00' },
    ...overrides,
  } as ScryfallCard;
}

let slotCounter = 0;
const slot = (card: ScryfallCard) => ({
  slotId: `slot-${slotCounter++}`,
  card,
  allocatedCopyId: null,
});

function makeDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-1',
    name: 'Deck',
    format: 'commander',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    generationContext: null,
    color: '#888888',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Deck;
}

describe('cardKey', () => {
  it('prefers oracle_id, falls back to name', () => {
    expect(cardKey(makeCard({ oracle_id: 'oid-X', name: 'Foo' }))).toBe('oid-X');
    expect(cardKey(makeCard({ oracle_id: '', name: 'Foo' }))).toBe('Foo');
  });
});

describe('cardUsd', () => {
  it('reads usd, then foil, then etched, else 0', () => {
    expect(cardUsd(makeCard({ prices: { usd: '2.50' } }))).toBe(2.5);
    expect(cardUsd(makeCard({ prices: { usd: null, usd_foil: '5' } }))).toBe(5);
    expect(cardUsd(makeCard({ prices: { usd_etched: '3' } }))).toBe(3);
    expect(cardUsd(makeCard({ prices: {} }))).toBe(0);
    expect(cardUsd(makeCard({ prices: { usd: 'n/a' } }))).toBe(0);
  });
});

describe('diffDeckCards', () => {
  const sol = makeCard({ oracle_id: 'sol', name: 'Sol Ring', type_line: 'Artifact', cmc: 1 });
  const bolt = makeCard({ oracle_id: 'bolt', name: 'Lightning Bolt', cmc: 1 });
  const forestA = makeCard({
    oracle_id: 'forest',
    name: 'Forest',
    type_line: 'Basic Land — Forest',
  });

  it('classifies added / removed / changed / unchanged keyed by oracle id', () => {
    const a = makeDeck({ cards: [slot(sol), slot(bolt), slot(forestA), slot(forestA)] });
    // B: drops bolt, keeps sol, adds a 3rd forest (qty change), adds a new card
    const wrath = makeCard({ oracle_id: 'wrath', name: 'Wrath of God' });
    const b = makeDeck({
      cards: [slot(sol), slot(forestA), slot(forestA), slot(forestA), slot(wrath)],
    });

    const d = diffDeckCards(a, b);
    expect(d.added.map((x) => x.card.name)).toEqual(['Wrath of God']);
    expect(d.removed.map((x) => x.card.name)).toEqual(['Lightning Bolt']);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].card.name).toBe('Forest');
    expect(d.changed[0].fromQty).toBe(2);
    expect(d.changed[0].toQty).toBe(3);
    expect(d.unchangedCount).toBe(1); // Sol Ring
  });

  it('folds commander(s) in and flags them', () => {
    const cmd = makeCard({ oracle_id: 'cmd', name: 'Atraxa' });
    const a = makeDeck({ commander: cmd, cards: [slot(sol)] });
    const b = makeDeck({ cards: [slot(sol)] }); // commander removed
    const d = diffDeckCards(a, b);
    expect(d.removed).toHaveLength(1);
    expect(d.removed[0].card.name).toBe('Atraxa');
    expect(d.removed[0].isCommander).toBe(true);
  });

  it('sorts each bucket by name', () => {
    const z = makeCard({ oracle_id: 'z', name: 'Zzz' });
    const aCard = makeCard({ oracle_id: 'a', name: 'Aaa' });
    const a = makeDeck({ cards: [] });
    const b = makeDeck({ cards: [slot(z), slot(aCard)] });
    expect(diffDeckCards(a, b).added.map((x) => x.card.name)).toEqual(['Aaa', 'Zzz']);
  });
});

describe('diffDeckPrice', () => {
  it('sums all copies incl. commander and reports the B − A delta', () => {
    const cmd = makeCard({ oracle_id: 'cmd', name: 'Cmd', prices: { usd: '10' } });
    const cheap = makeCard({ oracle_id: 'c', name: 'Cheap', prices: { usd: '1' } });
    const a = makeDeck({ commander: cmd, cards: [slot(cheap), slot(cheap)] }); // 10 + 2 = 12
    const b = makeDeck({ cards: [slot(cheap)] }); // 1
    const p = diffDeckPrice(a, b);
    expect(p.aTotal).toBe(12);
    expect(p.bTotal).toBe(1);
    expect(p.delta).toBe(-11);
  });
});

describe('diffDeckBracket', () => {
  it('reads override-wins bracket + grade, undefined when never analyzed', () => {
    const a = makeDeck({
      bracketOverride: 4,
      bracketEstimation: { bracket: 2 } as Deck['bracketEstimation'],
      deckGrade: { letter: 'A', headline: 'Strong' },
    });
    const b = makeDeck(); // never analyzed
    const d = diffDeckBracket(a, b);
    expect(d.a.bracket).toBe(4); // override wins over estimation 2
    expect(d.a.gradeLetter).toBe('A');
    expect(d.b.bracket).toBeUndefined();
    expect(d.b.gradeLetter).toBeUndefined();
  });
});

describe('diffDeckStats', () => {
  const oneDrop = makeCard({ oracle_id: '1', name: 'One', cmc: 1, type_line: 'Creature' });
  const threeDrop = makeCard({ oracle_id: '3', name: 'Three', cmc: 3, type_line: 'Instant' });
  const island = makeCard({
    oracle_id: 'isl',
    name: 'Island',
    cmc: 0,
    type_line: 'Basic Land — Island',
    color_identity: [],
  });

  it('deltas size, curve buckets, average cmc and types', () => {
    const a = makeDeck({ cards: [slot(oneDrop)] });
    const b = makeDeck({ cards: [slot(oneDrop), slot(threeDrop), slot(island)] });
    const s = diffDeckStats(a, b, false);

    expect(s.size.a).toBe(1);
    expect(s.size.b).toBe(3);
    expect(s.size.delta).toBe(2);

    const cmc3 = s.curve.buckets.find((x) => x.cmc === 3);
    expect(cmc3?.delta.delta).toBe(1); // B gained one 3-drop
    expect(s.curve.averageCmc.delta).not.toBe(0);

    expect(s.types.creatures.delta).toBe(0); // both have the one creature
    expect(s.types.instants.delta).toBe(1);
    expect(s.types.lands.delta).toBe(1);
  });

  it('counts colors per card (once per identity color) incl. colorless', () => {
    const wu = makeCard({ oracle_id: 'wu', name: 'WU', color_identity: ['W', 'U'] });
    const a = makeDeck({ cards: [] });
    const b = makeDeck({ cards: [slot(wu), slot(island)] });
    const s = diffDeckStats(a, b, false);
    expect(s.colors.W.delta).toBe(1);
    expect(s.colors.U.delta).toBe(1);
    expect(s.colors.R.delta).toBe(0);
    expect(s.colors.C.delta).toBe(1); // the colorless Island
  });

  it('reports taggerReady only when both analyses had the tagger', () => {
    const a = makeDeck({ cards: [slot(oneDrop)] });
    const b = makeDeck({ cards: [slot(threeDrop)] });
    expect(diffDeckStats(a, b, false).taggerReady).toBe(false);
    // lands role row exists regardless of the tagger (type-based)
    expect(diffDeckStats(a, b, false).roles.some((r) => r.key === 'lands')).toBe(true);
  });
});

describe('diffDecks', () => {
  it('composes every dimension', () => {
    const card = makeCard({ oracle_id: 'x', name: 'X' });
    const a = makeDeck({ cards: [slot(card)] });
    const b = makeDeck({ cards: [] });
    const d = diffDecks(a, b, false);
    expect(d.cards.removed).toHaveLength(1);
    expect(d.price.delta).toBeLessThan(0);
    expect(d.stats.size.delta).toBe(-1);
    expect(d.bracket.a.bracket).toBeUndefined();
  });
});
