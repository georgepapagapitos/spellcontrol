import { describe, expect, it } from 'vitest';
import { publicDeckToDeck, publicDeckLocalId } from './public-deck-to-deck';
import type { PublicDeck } from './shared-types';

function payload(overrides: Partial<PublicDeck> = {}): PublicDeck {
  return {
    ownerUsername: 'alice',
    ownerDisplayName: null,
    id: 'server-uuid-1',
    name: 'Korvold Sacrifice',
    format: 'commander',
    commander: { name: 'Korvold, Fae-Cursed King' },
    partnerCommander: null,
    cards: [{ card: { name: 'Sol Ring' } }, { card: { name: 'Sol Ring' } }],
    sideboard: [{ card: { name: 'Pithing Needle' } }],
    color: '#c2a14a',
    ...overrides,
  };
}

describe('publicDeckToDeck', () => {
  it('namespaces the local id so it can never collide with a deck of your own', () => {
    // The owner's uuid must NOT become the local id: deck-id-keyed local state
    // (playtest snapshots, session history) would then be shared between the
    // visitor's view of someone else's deck and their own copy of it.
    const deck = publicDeckToDeck(payload(), 'korvold-sacrifice');
    expect(deck.id).toBe('public:korvold-sacrifice');
    expect(deck.id).not.toBe('server-uuid-1');
    expect(publicDeckLocalId('tok_abc')).toBe('public:tok_abc');
  });

  it('gives every slot a stable id, one slot per copy', () => {
    const deck = publicDeckToDeck(payload(), 'k');
    expect(deck.cards.map((c) => c.slotId)).toEqual(['pub-main-0', 'pub-main-1']);
    expect(deck.sideboard.map((c) => c.slotId)).toEqual(['pub-side-0']);
    // Same payload in → same ids out, so a re-fetch doesn't invalidate a
    // playtest snapshot or remount every row.
    expect(publicDeckToDeck(payload(), 'k').cards[0].slotId).toBe(deck.cards[0].slotId);
  });

  it('claims no physical copies — a visitor owns none of them', () => {
    const deck = publicDeckToDeck(payload(), 'k');
    expect(deck.commanderAllocatedCopyId).toBeNull();
    expect(deck.partnerCommanderAllocatedCopyId).toBeNull();
    expect(deck.cards.every((c) => c.allocatedCopyId === null)).toBe(true);
  });

  it('leaves Considering empty — it is an owner-private scratch zone', () => {
    expect(publicDeckToDeck(payload(), 'k').considering).toEqual([]);
  });

  it('falls back to commander for a format with no config', () => {
    expect(publicDeckToDeck(payload({ format: 'nonsense' }), 'k').format).toBe('commander');
    expect(publicDeckToDeck(payload({ format: 'modern' }), 'k').format).toBe('modern');
  });

  it('carries the deck-describing analysis through to the Stats and Power tabs', () => {
    const deck = publicDeckToDeck(
      payload({
        planScore: { total: 72 },
        synergyAnalysis: { axes: [{ label: 'Sacrifice' }], warnings: [] },
        winConditions: { noClearWinCondition: false },
        winConTags: ['Korvold, Fae-Cursed King'],
        roleCounts: { ramp: 12 },
        roleTargets: { ramp: 10 },
        cardInclusionMap: { 'Sol Ring': 92.4 },
        edhrecNumDecks: 18432,
        archetypeOverride: 'aristocrats',
        bracketOverride: 4,
        averageSalt: 1.1,
        saltiestCards: [{ name: 'Cyclonic Rift', salt: 3.2 }],
      }),
      'k'
    );
    expect(deck.planScore).toEqual({ total: 72 });
    expect(deck.synergyAnalysis?.axes[0].label).toBe('Sacrifice');
    expect(deck.winConTags).toEqual(['Korvold, Fae-Cursed King']);
    expect(deck.roleCounts).toEqual({ ramp: 12 });
    expect(deck.roleTargets).toEqual({ ramp: 10 });
    expect(deck.cardInclusionMap).toEqual({ 'Sol Ring': 92.4 });
    expect(deck.edhrecNumDecks).toBe(18432);
    expect(deck.archetypeOverride).toBe('aristocrats');
    expect(deck.bracketOverride).toBe(4);
    expect(deck.saltiestCards).toEqual([{ name: 'Cyclonic Rift', salt: 3.2 }]);
  });

  it('produces a usable deck from a payload carrying no analysis at all', () => {
    const deck = publicDeckToDeck(payload(), 'k');
    expect(deck.planScore).toBeUndefined();
    expect(deck.winConditions).toBeUndefined();
    expect(deck.archetypeOverride).toBeNull();
    expect(deck.cards).toHaveLength(2);
    expect(deck.name).toBe('Korvold Sacrifice');
  });

  it('never fabricates a generation context', () => {
    // generationContext carries collectionMode — an owner-side fact. The
    // projection withholds it; the adapter must not invent one.
    expect(publicDeckToDeck(payload(), 'k').generationContext).toBeNull();
  });
});
