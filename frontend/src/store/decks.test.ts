import { describe, it, expect, beforeEach } from 'vitest';
import { useDecksStore, type Deck, type DeckCard } from './decks';
import { buildAllocationMap } from '../lib/allocations';
import type { EnrichedCard } from '../types';
import type { ScryfallCard } from '@/deck-builder/types';

function enriched(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: 'copy-1',
    name: 'Sol Ring',
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'uncommon',
    scryfallId: 'sf-1',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    ...overrides,
  };
}

function sfCard(name: string, id = 'sf-1'): ScryfallCard {
  return { name, id } as ScryfallCard;
}

function slot(name: string, allocatedCopyId: string | null, scryfallId = 'sf-1'): DeckCard {
  return {
    slotId: `slot-${name}-${Math.random().toString(36).slice(2, 6)}`,
    card: sfCard(name, scryfallId),
    allocatedCopyId,
  };
}

function baseDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    name: 'Test Deck',
    source: 'manual',
    format: 'commander',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    generationContext: null,
    color: '#7a8a70',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  useDecksStore.setState({ decks: [], hydrated: true });
});

describe('remapAllocations', () => {
  it('remaps allocated slots to new copyIds by card name', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          cards: [slot('Sol Ring', 'old-copy-1', 'sf-1')],
        }),
      ],
    });

    const newCollection = [
      enriched({ copyId: 'new-copy-1', name: 'Sol Ring', scryfallId: 'sf-1' }),
    ];
    useDecksStore.getState().remapAllocations(newCollection);

    const deck = useDecksStore.getState().decks[0];
    expect(deck.cards[0].allocatedCopyId).toBe('new-copy-1');
  });

  it('nulls allocation when card is not in new collection', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          cards: [slot('Sol Ring', 'old-copy-1')],
        }),
      ],
    });

    useDecksStore.getState().remapAllocations([]);

    const deck = useDecksStore.getState().decks[0];
    expect(deck.cards[0].allocatedCopyId).toBeNull();
  });

  it('allocates unallocated slots when a matching card exists in collection', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          cards: [slot('Sol Ring', null)],
        }),
      ],
    });

    const newCollection = [enriched({ copyId: 'new-copy-1' })];
    useDecksStore.getState().remapAllocations(newCollection);

    const deck = useDecksStore.getState().decks[0];
    expect(deck.cards[0].allocatedCopyId).toBe('new-copy-1');
  });

  it('leaves unallocated slots null when card is not in collection', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          cards: [slot('Mana Crypt', null)],
        }),
      ],
    });

    const newCollection = [enriched({ copyId: 'new-copy-1', name: 'Sol Ring' })];
    useDecksStore.getState().remapAllocations(newCollection);

    const deck = useDecksStore.getState().decks[0];
    expect(deck.cards[0].allocatedCopyId).toBeNull();
  });

  it('re-allocates after collection delete and reimport', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          cards: [slot('Sol Ring', 'old-copy-1')],
        }),
      ],
    });

    // Step 1: collection deleted — remap against empty nulls all allocations
    useDecksStore.getState().remapAllocations([]);
    expect(useDecksStore.getState().decks[0].cards[0].allocatedCopyId).toBeNull();

    // Step 2: new collection imported — should re-allocate
    const freshCollection = [enriched({ copyId: 'fresh-copy', name: 'Sol Ring' })];
    useDecksStore.getState().remapAllocations(freshCollection);
    expect(useDecksStore.getState().decks[0].cards[0].allocatedCopyId).toBe('fresh-copy');
  });

  it('avoids double-claiming the same copy across decks', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          id: 'd1',
          cards: [slot('Sol Ring', 'old-1')],
        }),
        baseDeck({
          id: 'd2',
          name: 'Deck 2',
          cards: [slot('Sol Ring', 'old-2')],
        }),
      ],
    });

    const newCollection = [enriched({ copyId: 'only-copy', name: 'Sol Ring' })];
    useDecksStore.getState().remapAllocations(newCollection);

    const [d1, d2] = useDecksStore.getState().decks;
    expect(d1.cards[0].allocatedCopyId).toBe('only-copy');
    expect(d2.cards[0].allocatedCopyId).toBeNull();
  });

  it('prefers same printing when multiple copies exist', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          cards: [slot('Sol Ring', 'old-1', 'sf-ONE')],
        }),
      ],
    });

    const newCollection = [
      enriched({ copyId: 'cmr-copy', name: 'Sol Ring', scryfallId: 'sf-CMR', purchasePrice: 1 }),
      enriched({ copyId: 'one-copy', name: 'Sol Ring', scryfallId: 'sf-ONE', purchasePrice: 50 }),
    ];
    useDecksStore.getState().remapAllocations(newCollection);

    const deck = useDecksStore.getState().decks[0];
    expect(deck.cards[0].allocatedCopyId).toBe('one-copy');
  });

  it('remaps commander and partner commander allocations', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          commander: sfCard('Atraxa', 'sf-atraxa'),
          commanderAllocatedCopyId: 'old-cmd',
          partnerCommander: sfCard('Thrasios', 'sf-thrasios'),
          partnerCommanderAllocatedCopyId: 'old-partner',
        }),
      ],
    });

    const newCollection = [
      enriched({ copyId: 'new-cmd', name: 'Atraxa', scryfallId: 'sf-atraxa' }),
      enriched({ copyId: 'new-partner', name: 'Thrasios', scryfallId: 'sf-thrasios' }),
    ];
    useDecksStore.getState().remapAllocations(newCollection);

    const deck = useDecksStore.getState().decks[0];
    expect(deck.commanderAllocatedCopyId).toBe('new-cmd');
    expect(deck.partnerCommanderAllocatedCopyId).toBe('new-partner');
  });

  it('remaps sideboard allocations', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          sideboard: [slot('Swords to Plowshares', 'old-sb-1', 'sf-stp')],
        }),
      ],
    });

    const newCollection = [
      enriched({ copyId: 'new-sb', name: 'Swords to Plowshares', scryfallId: 'sf-stp' }),
    ];
    useDecksStore.getState().remapAllocations(newCollection);

    const deck = useDecksStore.getState().decks[0];
    expect(deck.sideboard[0].allocatedCopyId).toBe('new-sb');
  });

  it('upgrades a wrong-printing binding to the slot preferred printing when free', () => {
    // Pre-fix code may have shuffled this slot onto a same-name but wrong-
    // printing copy. Stability alone preserved the wrong binding forever.
    // The corrective pass must swap to the preferred printing when free.
    // (Non-basic — basic lands are fungible and exempt; see next test.)
    useDecksStore.setState({
      decks: [
        baseDeck({
          cards: [slot('Sol Ring', 'wrong-printing-copy', 'sf-preferred')],
        }),
      ],
    });

    const collection = [
      enriched({
        copyId: 'wrong-printing-copy',
        name: 'Sol Ring',
        scryfallId: 'sf-other',
        setCode: 'C20',
      }),
      enriched({
        copyId: 'right-printing-copy',
        name: 'Sol Ring',
        scryfallId: 'sf-preferred',
        setCode: 'CMR',
      }),
    ];
    useDecksStore.getState().remapAllocations(collection);

    expect(useDecksStore.getState().decks[0].cards[0].allocatedCopyId).toBe('right-printing-copy');
  });

  it('upgrades a basic-land binding to the slot preferred printing when free', () => {
    // Special-art / foil basics ARE a meaningful choice. A Plains slot that
    // prefers a specific printing must claim that copy (e.g. a Secret Lair
    // basic) when a free one exists, not sit on an arbitrary other printing.
    useDecksStore.setState({
      decks: [
        baseDeck({
          cards: [slot('Plains', 'bound-copy', 'sf-preferred')],
        }),
      ],
    });

    const collection = [
      enriched({
        copyId: 'bound-copy',
        name: 'Plains',
        scryfallId: 'sf-other',
        setCode: 'M20',
      }),
      enriched({
        copyId: 'preferred-copy',
        name: 'Plains',
        scryfallId: 'sf-preferred',
        setCode: 'ECL',
      }),
    ];
    useDecksStore.getState().remapAllocations(collection);

    expect(useDecksStore.getState().decks[0].cards[0].allocatedCopyId).toBe('preferred-copy');
  });

  it('keeps wrong-printing binding when no preferred-printing copy is free', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          cards: [slot('Plains', 'wrong-printing-copy', 'sf-preferred')],
        }),
      ],
    });

    // Only the wrong printing is owned — don't churn, keep what we have.
    const collection = [
      enriched({ copyId: 'wrong-printing-copy', name: 'Plains', scryfallId: 'sf-other' }),
    ];
    useDecksStore.getState().remapAllocations(collection);

    expect(useDecksStore.getState().decks[0].cards[0].allocatedCopyId).toBe('wrong-printing-copy');
  });

  it('distributes scarce preferred-printing copies fairly across slots', () => {
    // Two slots want printing X. Only one copy of X is owned. The other
    // slot should fall back to a free non-preferred copy rather than be
    // unowned.
    useDecksStore.setState({
      decks: [
        baseDeck({
          cards: [slot('Plains', 'old-1', 'sf-preferred'), slot('Plains', 'old-2', 'sf-preferred')],
        }),
      ],
    });

    const collection = [
      enriched({ copyId: 'pref', name: 'Plains', scryfallId: 'sf-preferred' }),
      enriched({ copyId: 'other', name: 'Plains', scryfallId: 'sf-other' }),
    ];
    useDecksStore.getState().remapAllocations(collection);

    const allocated = useDecksStore.getState().decks[0].cards.map((c) => c.allocatedCopyId);
    expect(allocated).toContain('pref');
    expect(allocated).toContain('other');
    expect(new Set(allocated).size).toBe(2);
  });

  it('preserves existing binding when the allocated copy still exists', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          cards: [slot('Sol Ring', 'stable-copy', 'sf-1')],
        }),
      ],
    });

    // Same copyId is still in the collection; remap must not rebind.
    const collection = [
      enriched({ copyId: 'other-copy', name: 'Sol Ring', purchasePrice: 0.01 }),
      enriched({ copyId: 'stable-copy', name: 'Sol Ring', purchasePrice: 5 }),
    ];
    useDecksStore.getState().remapAllocations(collection);

    const deck = useDecksStore.getState().decks[0];
    expect(deck.cards[0].allocatedCopyId).toBe('stable-copy');
  });

  it('does not bump updatedAt when no bindings change', () => {
    const originalUpdatedAt = 1000;
    useDecksStore.setState({
      decks: [
        baseDeck({
          updatedAt: originalUpdatedAt,
          cards: [slot('Sol Ring', 'stable-copy', 'sf-1')],
        }),
      ],
    });

    const collection = [enriched({ copyId: 'stable-copy', name: 'Sol Ring' })];
    useDecksStore.getState().remapAllocations(collection);

    expect(useDecksStore.getState().decks[0].updatedAt).toBe(originalUpdatedAt);
  });

  it('preserves later-deck bindings when an earlier deck would have stolen the copy', () => {
    // Without two-pass remap, d1's "Sol Ring" slot (unallocated) would grab the
    // only Sol Ring, leaving d2's stable binding broken. The fix preserves d2.
    useDecksStore.setState({
      decks: [
        baseDeck({
          id: 'd1',
          cards: [slot('Sol Ring', null, 'sf-1')],
        }),
        baseDeck({
          id: 'd2',
          name: 'Deck 2',
          cards: [slot('Sol Ring', 'shared-copy', 'sf-1')],
        }),
      ],
    });

    const collection = [enriched({ copyId: 'shared-copy', name: 'Sol Ring' })];
    useDecksStore.getState().remapAllocations(collection);

    const [d1, d2] = useDecksStore.getState().decks;
    expect(d2.cards[0].allocatedCopyId).toBe('shared-copy');
    expect(d1.cards[0].allocatedCopyId).toBeNull();
  });

  it('rebinds when the stored copy was renamed (defensive against user edits)', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          cards: [slot('Sol Ring', 'edited-copy', 'sf-1')],
        }),
      ],
    });

    // User edited the card and changed its name — the copyId still exists but
    // no longer matches what the deck slot expects. Treat as broken; re-pick.
    const collection = [
      enriched({ copyId: 'edited-copy', name: 'Manalith' }),
      enriched({ copyId: 'real-sr', name: 'Sol Ring' }),
    ];
    useDecksStore.getState().remapAllocations(collection);

    expect(useDecksStore.getState().decks[0].cards[0].allocatedCopyId).toBe('real-sr');
  });

  it('keeps binding stable across reorder-only collection changes', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          cards: [slot('Sol Ring', 'sr-copy', 'sf-1'), slot('Mana Crypt', 'mc-copy', 'sf-2')],
        }),
      ],
    });

    const a = [
      enriched({ copyId: 'sr-copy', name: 'Sol Ring', scryfallId: 'sf-1' }),
      enriched({ copyId: 'mc-copy', name: 'Mana Crypt', scryfallId: 'sf-2' }),
    ];
    const b = [a[1], a[0]];

    useDecksStore.getState().remapAllocations(a);
    const snapshot1 = useDecksStore.getState().decks[0];
    useDecksStore.getState().remapAllocations(b);
    const snapshot2 = useDecksStore.getState().decks[0];

    expect(snapshot2.cards[0].allocatedCopyId).toBe('sr-copy');
    expect(snapshot2.cards[1].allocatedCopyId).toBe('mc-copy');
    expect(snapshot2.updatedAt).toBe(snapshot1.updatedAt);
  });

  it('handles mixed allocated and unallocated across multiple decks', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          id: 'd1',
          cards: [slot('Sol Ring', 'old-sr'), slot('Mana Crypt', null)],
        }),
        baseDeck({
          id: 'd2',
          name: 'Deck 2',
          cards: [slot('Lightning Bolt', 'old-bolt')],
        }),
      ],
    });

    const newCollection = [
      enriched({ copyId: 'new-sr', name: 'Sol Ring' }),
      enriched({ copyId: 'new-bolt', name: 'Lightning Bolt', scryfallId: 'sf-bolt' }),
    ];
    useDecksStore.getState().remapAllocations(newCollection);

    const [d1, d2] = useDecksStore.getState().decks;
    expect(d1.cards[0].allocatedCopyId).toBe('new-sr');
    expect(d1.cards[1].allocatedCopyId).toBeNull();
    expect(d2.cards[0].allocatedCopyId).toBe('new-bolt');
  });
});

/**
 * Invariant we want to hold no matter what sequence of mutations happens to
 * the collection or the decks:
 *   - No copyId is claimed by two different deck slots simultaneously.
 *   - Every claimed copyId actually exists in the current collection.
 *   - The number of allocated slots for a given card name ≤ number of copies
 *     of that name in the collection.
 *
 * The check below is a small property-style sweep — not full QuickCheck — but
 * exercises the realistic mutation flow (import → remap → mutate → remap).
 */
describe('allocation invariants', () => {
  function assertInvariants(collection: EnrichedCard[]) {
    const { decks } = useDecksStore.getState();
    const allocations = buildAllocationMap(decks);
    const collectionById = new Map(collection.map((c) => [c.copyId, c]));

    // Every claimed copyId exists in collection.
    for (const [copyId] of allocations) {
      expect(collectionById.has(copyId)).toBe(true);
    }

    // No copyId is claimed twice — the map can't represent it, but verify
    // by walking the raw deck list and counting.
    const claims = new Map<string, number>();
    for (const deck of decks) {
      const all = [
        deck.commanderAllocatedCopyId,
        deck.partnerCommanderAllocatedCopyId,
        ...deck.cards.map((c) => c.allocatedCopyId),
        ...(deck.sideboard ?? []).map((c) => c.allocatedCopyId),
      ];
      for (const id of all) {
        if (!id) continue;
        claims.set(id, (claims.get(id) ?? 0) + 1);
      }
    }
    for (const [copyId, count] of claims) {
      expect(count, `copyId ${copyId} claimed ${count} times`).toBe(1);
    }

    // Per-name allocations don't exceed owned copies.
    const ownedByName = new Map<string, number>();
    for (const c of collection) {
      ownedByName.set(c.name, (ownedByName.get(c.name) ?? 0) + 1);
    }
    const allocatedByName = new Map<string, number>();
    for (const deck of decks) {
      const named = [
        deck.commander && deck.commanderAllocatedCopyId ? deck.commander.name : null,
        deck.partnerCommander && deck.partnerCommanderAllocatedCopyId
          ? deck.partnerCommander.name
          : null,
        ...deck.cards.filter((c) => c.allocatedCopyId).map((c) => c.card.name),
        ...(deck.sideboard ?? []).filter((c) => c.allocatedCopyId).map((c) => c.card.name),
      ];
      for (const n of named) {
        if (!n) continue;
        allocatedByName.set(n, (allocatedByName.get(n) ?? 0) + 1);
      }
    }
    for (const [name, count] of allocatedByName) {
      expect(count).toBeLessThanOrEqual(ownedByName.get(name) ?? 0);
    }
  }

  it('holds across a realistic import → mutate → reimport flow', () => {
    // Two decks, both want Sol Ring; one wants Lightning Bolt.
    useDecksStore.setState({
      decks: [
        baseDeck({
          id: 'd1',
          name: 'A',
          cards: [slot('Sol Ring', null, 'sf-sr-1'), slot('Lightning Bolt', null, 'sf-bolt')],
        }),
        baseDeck({
          id: 'd2',
          name: 'B',
          cards: [slot('Sol Ring', null, 'sf-sr-2')],
        }),
      ],
    });

    // Initial import: 2 Sol Rings (different printings), 1 bolt.
    const v1 = [
      enriched({ copyId: 'sr-cmr', name: 'Sol Ring', scryfallId: 'sf-sr-1', purchasePrice: 1 }),
      enriched({ copyId: 'sr-one', name: 'Sol Ring', scryfallId: 'sf-sr-2', purchasePrice: 50 }),
      enriched({ copyId: 'bolt-1', name: 'Lightning Bolt', scryfallId: 'sf-bolt' }),
    ];
    useDecksStore.getState().remapAllocations(v1);
    assertInvariants(v1);

    // Each deck got the matching printing.
    const [d1a, d2a] = useDecksStore.getState().decks;
    expect(d1a.cards[0].allocatedCopyId).toBe('sr-cmr');
    expect(d2a.cards[0].allocatedCopyId).toBe('sr-one');

    // Merge-import adds a 3rd Sol Ring of a new printing. Bindings shouldn't move.
    const v2 = [
      ...v1,
      enriched({ copyId: 'sr-extra', name: 'Sol Ring', scryfallId: 'sf-sr-x', purchasePrice: 2 }),
    ];
    useDecksStore.getState().remapAllocations(v2);
    assertInvariants(v2);
    const [d1b, d2b] = useDecksStore.getState().decks;
    expect(d1b.cards[0].allocatedCopyId).toBe('sr-cmr');
    expect(d2b.cards[0].allocatedCopyId).toBe('sr-one');

    // Delete the copy d1 was bound to (simulates "delete import"). d1 must
    // rebind to a free copy; d2 must stay put.
    const v3 = v2.filter((c) => c.copyId !== 'sr-cmr');
    useDecksStore.getState().remapAllocations(v3);
    assertInvariants(v3);
    const [d1c, d2c] = useDecksStore.getState().decks;
    expect(d1c.cards[0].allocatedCopyId).toBe('sr-extra'); // only free Sol Ring
    expect(d2c.cards[0].allocatedCopyId).toBe('sr-one');

    // Clear the entire collection. Everything goes to null, no invariant break.
    useDecksStore.getState().remapAllocations([]);
    assertInvariants([]);
  });

  it('never double-claims even when more deck slots want a card than are owned', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          id: 'd1',
          cards: [slot('Sol Ring', null), slot('Sol Ring', null), slot('Sol Ring', null)],
        }),
      ],
    });

    const collection = [
      enriched({ copyId: 'a', name: 'Sol Ring' }),
      enriched({ copyId: 'b', name: 'Sol Ring' }),
    ];
    useDecksStore.getState().remapAllocations(collection);
    assertInvariants(collection);

    const deck = useDecksStore.getState().decks[0];
    const allocated = deck.cards.map((c) => c.allocatedCopyId).filter(Boolean);
    expect(new Set(allocated).size).toBe(allocated.length); // unique
    expect(allocated).toHaveLength(2); // third slot unowned
  });

  it('reconciles a persisted cross-deck double-claim through remap (first deck wins)', () => {
    // A manual mutation / generated-deck save in a prior session bound the
    // SAME physical copy to two decks. The copy still exists in the
    // collection, so a naive pass-1 "keep current binding" would preserve
    // both. The dedupe folded into remap must collapse it to one.
    useDecksStore.setState({
      decks: [
        baseDeck({ id: 'd1', name: 'A', cards: [slot('Sol Ring', 'shared', 'sf-1')] }),
        baseDeck({ id: 'd2', name: 'B', cards: [slot('Sol Ring', 'shared', 'sf-1')] }),
      ],
    });

    const collection = [enriched({ copyId: 'shared', name: 'Sol Ring', scryfallId: 'sf-1' })];
    useDecksStore.getState().remapAllocations(collection);
    assertInvariants(collection);

    const [d1, d2] = useDecksStore.getState().decks;
    expect(d1.cards[0].allocatedCopyId).toBe('shared');
    expect(d2.cards[0].allocatedCopyId).toBeNull(); // only one copy is owned
  });

  it('no copyId resolves into two decks across 300 random remap sequences', () => {
    // Deterministic LCG so a failure reproduces (same pattern as
    // binder-refs.test.ts's property test).
    let seed = 0x1234abcd >>> 0;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const NAMES = ['Sol Ring', 'Mana Crypt', 'Lightning Bolt', 'Plains'];
    const PRINTINGS = ['p1', 'p2'];

    for (let trial = 0; trial < 300; trial++) {
      // Random collection: 0..3 copies per (name, printing), fresh copyIds.
      let uid = 0;
      const collection: EnrichedCard[] = [];
      for (const name of NAMES)
        for (const sf of PRINTINGS) {
          const n = Math.floor(rnd() * 4);
          for (let i = 0; i < n; i++)
            collection.push(enriched({ copyId: `c${trial}_${uid++}`, name, scryfallId: sf }));
        }
      const ids = collection.map((c) => c.copyId);

      // 1..3 decks, each 0..6 slots. Allocations are deliberately drawn from
      // the same id pool (with replacement) so duplicates are common —
      // including the same id reused across decks and within a deck.
      const pickId = (): string | null => {
        if (ids.length === 0 || rnd() < 0.25) return null;
        return ids[Math.floor(rnd() * ids.length)];
      };
      const deckCount = 1 + Math.floor(rnd() * 3);
      const decks: Deck[] = [];
      for (let d = 0; d < deckCount; d++) {
        const slotCount = Math.floor(rnd() * 7);
        const cards: DeckCard[] = [];
        for (let s = 0; s < slotCount; s++) {
          const name = NAMES[Math.floor(rnd() * NAMES.length)];
          cards.push({
            slotId: `t${trial}_d${d}_s${s}`,
            card: sfCard(name, PRINTINGS[Math.floor(rnd() * PRINTINGS.length)]),
            allocatedCopyId: pickId(),
          });
        }
        decks.push(baseDeck({ id: `t${trial}_d${d}`, name: `D${d}`, cards }));
      }

      useDecksStore.setState({ decks });
      useDecksStore.getState().remapAllocations(collection);

      const out = useDecksStore.getState().decks;
      const seen = new Set<string>();
      for (const deck of out) {
        const all = [
          deck.commanderAllocatedCopyId,
          deck.partnerCommanderAllocatedCopyId,
          ...deck.cards.map((c) => c.allocatedCopyId),
          ...(deck.sideboard ?? []).map((c) => c.allocatedCopyId),
        ];
        for (const id of all) {
          if (!id) continue;
          expect(seen.has(id), `trial ${trial}: copyId ${id} double-claimed`).toBe(false);
          seen.add(id);
          // And every surviving binding points at a real owned copy.
          expect(ids.includes(id)).toBe(true);
        }
      }
    }
  });

  // B1-deck: the deck-remap analogue of binder-refs.test.ts's 400-op seeded
  // property test. Arbitrary add-slot / remove-slot / re-import (copyIds
  // regenerated, owned multiset perturbed) / inject-double-claim histories
  // must leave remap satisfying the full resilience contract: every still-
  // owned card re-binds, no copyId double-claimed, per-name multiplicity is
  // exactly min(slots-wanting, owned), and a second remap on the same
  // collection is a no-op (idempotent).
  it('remap upholds rebind + multiplicity + no-double-claim + idempotence across 400 random ops', () => {
    // Deterministic LCG so a failure reproduces.
    let seed = 0x5bd1e995 >>> 0;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];

    // Card universe: non-basics plus a basic land — printing is meaningful
    // intent for both now (special-art basics are a real choice). Each name
    // has two printings.
    const NONBASIC = ['Sol Ring', 'Mana Crypt', 'Lightning Bolt'];
    const NAMES = [...NONBASIC, 'Plains'];
    const PRINTINGS: Record<string, [string, string]> = {
      'Sol Ring': ['sf-sr-a', 'sf-sr-b'],
      'Mana Crypt': ['sf-mc-a', 'sf-mc-b'],
      'Lightning Bolt': ['sf-lb-a', 'sf-lb-b'],
      Plains: ['sf-pl-a', 'sf-pl-b'],
    };

    let uid = 0;
    let collection: EnrichedCard[] = [];
    const regenCollection = (): void => {
      const next: EnrichedCard[] = [];
      for (const name of NAMES)
        for (const sf of PRINTINGS[name]) {
          const n = Math.floor(rnd() * 3); // 0..2 copies per (name, printing)
          for (let i = 0; i < n; i++)
            next.push(enriched({ copyId: `c${uid++}`, name, scryfallId: sf, purchasePrice: 1 }));
        }
      collection = next;
    };

    const DECK_IDS = ['pd1', 'pd2'];
    useDecksStore.setState({
      decks: DECK_IDS.map((id) => baseDeck({ id, name: id, cards: [] })),
    });
    regenCollection();

    const allSlots = () => {
      const out: { deckId: string; idx: number }[] = [];
      for (const d of useDecksStore.getState().decks)
        d.cards.forEach((_, idx) => out.push({ deckId: d.id, idx }));
      return out;
    };
    const setDeckCards = (deckId: string, mut: (cards: DeckCard[]) => DeckCard[]): void => {
      useDecksStore.setState((s) => ({
        decks: s.decks.map((d) => (d.id === deckId ? { ...d, cards: mut([...d.cards]) } : d)),
      }));
    };

    const snapshotAllocs = (): string[] =>
      useDecksStore
        .getState()
        .decks.flatMap((d) =>
          d.cards.map((c) => `${d.id}:${c.slotId}=${c.allocatedCopyId ?? '∅'}`)
        );

    for (let step = 0; step < 400; step++) {
      const op = Math.floor(rnd() * 4);
      if (op === 0) {
        // add slot: random deck, random card name + printing, unbound.
        const deckId = pick(DECK_IDS);
        const name = pick(NAMES);
        const sf = pick(PRINTINGS[name]);
        setDeckCards(deckId, (cards) => {
          cards.push({ slotId: `ps${uid++}`, card: sfCard(name, sf), allocatedCopyId: null });
          return cards;
        });
      } else if (op === 1) {
        // remove a random slot
        const slots = allSlots();
        if (slots.length) {
          const { deckId, idx } = pick(slots);
          setDeckCards(deckId, (cards) => {
            cards.splice(idx, 1);
            return cards;
          });
        }
      } else if (op === 2) {
        // inject a cross-slot double-claim (the A3 hazard a manual mutation
        // would create) so the next reimport's remap must heal it.
        const slots = allSlots();
        const bound = useDecksStore
          .getState()
          .decks.flatMap((d) => d.cards.map((c) => c.allocatedCopyId))
          .filter((x): x is string => !!x);
        if (slots.length && bound.length) {
          const victimId = pick(bound);
          const { deckId, idx } = pick(slots);
          setDeckCards(deckId, (cards) => {
            cards[idx] = { ...cards[idx], allocatedCopyId: victimId };
            return cards;
          });
        }
      } else {
        // reimport: brand-new copyIds, perturbed owned multiset, then remap.
        regenCollection();
        useDecksStore.getState().remapAllocations(collection);

        const decks = useDecksStore.getState().decks;
        const ownedById = new Map(collection.map((c) => [c.copyId, c]));
        const ownedByName = new Map<string, number>();
        for (const c of collection) ownedByName.set(c.name, (ownedByName.get(c.name) ?? 0) + 1);

        // I1: every non-null binding is a distinct, currently-owned copy.
        const seen = new Set<string>();
        for (const d of decks)
          for (const c of d.cards) {
            if (!c.allocatedCopyId) continue;
            expect(
              seen.has(c.allocatedCopyId),
              `step ${step}: ${c.allocatedCopyId} double-claimed`
            ).toBe(false);
            seen.add(c.allocatedCopyId);
            expect(ownedById.has(c.allocatedCopyId)).toBe(true);
          }

        // I2: per name, #bound == min(#slots wanting it, #owned of it).
        // (Printing only affects WHICH copy, never WHETHER one is found.)
        const wantByName = new Map<string, number>();
        const boundByName = new Map<string, number>();
        for (const d of decks)
          for (const c of d.cards) {
            wantByName.set(c.card.name, (wantByName.get(c.card.name) ?? 0) + 1);
            if (c.allocatedCopyId)
              boundByName.set(c.card.name, (boundByName.get(c.card.name) ?? 0) + 1);
          }
        for (const name of NAMES) {
          const want = wantByName.get(name) ?? 0;
          const own = ownedByName.get(name) ?? 0;
          const got = boundByName.get(name) ?? 0;
          expect(got, `step ${step}: ${name} bound ${got}, expected min(${want},${own})`).toBe(
            Math.min(want, own)
          );
        }

        // I3: a second remap on the identical collection is a no-op.
        const before = snapshotAllocs();
        useDecksStore.getState().remapAllocations(collection);
        expect(snapshotAllocs(), `step ${step}: remap not idempotent`).toEqual(before);
      }
    }
  });
});

describe('deleteDecks (bulk)', () => {
  it('removes exactly the given ids and leaves the rest', () => {
    useDecksStore.setState({
      decks: [baseDeck({ id: 'a' }), baseDeck({ id: 'b' }), baseDeck({ id: 'c' })],
    });
    useDecksStore.getState().deleteDecks(['a', 'c']);
    expect(useDecksStore.getState().decks.map((d) => d.id)).toEqual(['b']);
  });

  it('is a no-op when no id matches', () => {
    useDecksStore.setState({ decks: [baseDeck({ id: 'a' })] });
    useDecksStore.getState().deleteDecks(['nope']);
    expect(useDecksStore.getState().decks.map((d) => d.id)).toEqual(['a']);
  });
});
