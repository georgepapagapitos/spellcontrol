import { describe, it, expect } from 'vitest';
import {
  reconcileBinderRefs,
  addRef,
  removeRef,
  setOrderRefs,
  printingFinishKey,
} from './binder-refs';
import type { BinderDef, EnrichedCard } from '../types';

function card(
  copyId: string,
  scryfallId: string,
  finish: 'nonfoil' | 'foil' = 'nonfoil'
): EnrichedCard {
  return { copyId, scryfallId, finish, name: scryfallId, foil: finish === 'foil' } as EnrichedCard;
}

function binder(over: Partial<BinderDef>): BinderDef {
  return {
    id: 'b1',
    name: 'B',
    position: 0,
    filterGroups: [{ filter: {} }],
    sorts: [],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#000',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  } as BinderDef;
}

describe('printingFinishKey', () => {
  it('keys by scryfallId + finish', () => {
    expect(printingFinishKey(card('x', 'sf1', 'foil'))).toBe('sf1:foil');
    expect(printingFinishKey(card('x', 'sf1'))).toBe('sf1:nonfoil');
  });
});

describe('reconcileBinderRefs — re-import recovery (the headline fix)', () => {
  it('re-binds a pin to the equivalent new copy after copyIds are regenerated', () => {
    const b = binder({ pinnedCopyIds: ['old-1'], pinnedKeys: ['sf1:nonfoil'] });
    // Re-upload: same card, brand-new copyId. No prev collection (cache lost).
    const newCards = [card('new-1', 'sf1', 'nonfoil')];

    const { binders, changed } = reconcileBinderRefs([b], newCards, []);

    expect(changed).toBe(true);
    expect(binders[0].pinnedCopyIds).toEqual(['new-1']);
    expect(binders[0].pinnedKeys).toEqual(['sf1:nonfoil']);
  });

  it('preserves multiplicity: 2 pinned of 3 owned re-resolve to 2 distinct copies', () => {
    const b = binder({
      pinnedCopyIds: ['o1', 'o2'],
      pinnedKeys: ['sf1:nonfoil', 'sf1:nonfoil'],
    });
    const newCards = [
      card('n1', 'sf1', 'nonfoil'),
      card('n2', 'sf1', 'nonfoil'),
      card('n3', 'sf1', 'nonfoil'),
    ];

    const { binders } = reconcileBinderRefs([b], newCards, []);

    expect(binders[0].pinnedCopyIds).toHaveLength(2);
    expect(new Set(binders[0].pinnedCopyIds)).toEqual(new Set(['n1', 'n2']));
  });

  it('retains a key with no owned copy so a later re-import can restore it', () => {
    const b = binder({ pinnedCopyIds: ['old'], pinnedKeys: ['sfMissing:nonfoil'] });

    const first = reconcileBinderRefs([b], [card('n', 'sfOther')], []);
    expect(first.binders[0].pinnedCopyIds).toEqual([]); // not owned now
    expect(first.binders[0].pinnedKeys).toEqual(['sfMissing:nonfoil']); // intent kept

    // The printing comes back in a later import — pin must reattach.
    const second = reconcileBinderRefs(
      [first.binders[0]],
      [card('back', 'sfMissing', 'nonfoil')],
      []
    );
    expect(second.binders[0].pinnedCopyIds).toEqual(['back']);
  });
});

describe('reconcileBinderRefs — stability & no-op behavior', () => {
  it('is a no-op (same reference) when ids still resolve and keys already set', () => {
    const b = binder({ pinnedCopyIds: ['c1'], pinnedKeys: ['sf1:nonfoil'] });
    const cards = [card('c1', 'sf1', 'nonfoil')];

    const { binders, changed } = reconcileBinderRefs([b], cards, cards);

    expect(changed).toBe(false);
    expect(binders[0]).toBe(b); // referential identity preserved (no phantom push)
  });

  it('leaves binders without pins or exclusions untouched', () => {
    const b = binder({});
    const { binders, changed } = reconcileBinderRefs([b], [card('c', 'sf')], []);
    expect(changed).toBe(false);
    expect(binders[0]).toBe(b);
  });
});

describe('reconcileBinderRefs — legacy backfill (immunize current good state)', () => {
  it('backfills pinnedKeys from current ids on a binder created before the shadow existed', () => {
    const b = binder({ pinnedCopyIds: ['c1'] }); // no pinnedKeys (legacy)
    const cards = [card('c1', 'sf1', 'foil')];

    const { binders, changed } = reconcileBinderRefs([b], cards, cards);

    expect(changed).toBe(true);
    expect(binders[0].pinnedKeys).toEqual(['sf1:foil']);
    expect(binders[0].pinnedCopyIds).toEqual(['c1']); // id unchanged
  });
});

describe('reconcileBinderRefs — exclusions', () => {
  it('re-resolves excludedCopyIds the same way as pins', () => {
    const b = binder({ excludedCopyIds: ['old'], excludedKeys: ['sf1:nonfoil'] });
    const newCards = [card('new', 'sf1', 'nonfoil')];

    const { binders, changed } = reconcileBinderRefs([b], newCards, []);

    expect(changed).toBe(true);
    expect(binders[0].excludedCopyIds).toEqual(['new']);
    expect(binders[0].excludedKeys).toEqual(['sf1:nonfoil']);
  });
});

describe('reconcileBinderRefs — manualOrder (hand-arranged card order)', () => {
  it('re-binds manual order to the equivalent new copies after copyIds regenerate', () => {
    const b = binder({
      manualOrder: ['old-1'],
      manualKeys: ['sf1:nonfoil'],
    });
    const newCards = [card('new-1', 'sf1', 'nonfoil')];

    const { binders, changed } = reconcileBinderRefs([b], newCards, []);

    expect(changed).toBe(true);
    expect(binders[0].manualOrder).toEqual(['new-1']);
    expect(binders[0].manualKeys).toEqual(['sf1:nonfoil']);
  });

  it('preserves the arranged ORDER and multiplicity across a re-import', () => {
    // User dragged B before two copies of A. Keys, not ids, carry that intent.
    const b = binder({
      manualOrder: ['oB', 'oA1', 'oA2'],
      manualKeys: ['sf2:nonfoil', 'sf1:nonfoil', 'sf1:nonfoil'],
    });
    // Re-upload: brand-new copyIds, and the collection lists A's before B.
    const newCards = [
      card('nA1', 'sf1', 'nonfoil'),
      card('nA2', 'sf1', 'nonfoil'),
      card('nB', 'sf2', 'nonfoil'),
    ];

    const { binders } = reconcileBinderRefs([b], newCards, []);

    // B still first, then both A copies — the user's order survived.
    expect(binders[0].manualOrder).toEqual(['nB', 'nA1', 'nA2']);
    expect(binders[0].manualKeys).toEqual(['sf2:nonfoil', 'sf1:nonfoil', 'sf1:nonfoil']);
  });

  it('retains an ordered slot with no owned copy so a later re-import restores it', () => {
    const b = binder({
      manualOrder: ['oA', 'oMissing'],
      manualKeys: ['sf1:nonfoil', 'sfGone:nonfoil'],
    });

    const first = reconcileBinderRefs([b], [card('nA', 'sf1', 'nonfoil')], []);
    expect(first.binders[0].manualOrder).toEqual(['nA']); // missing slot drops out
    expect(first.binders[0].manualKeys).toEqual(['sf1:nonfoil', 'sfGone:nonfoil']); // intent kept

    // The missing printing comes back — its slot must reappear in order.
    const second = reconcileBinderRefs(
      [first.binders[0]],
      [card('nA2', 'sf1', 'nonfoil'), card('back', 'sfGone', 'nonfoil')],
      []
    );
    expect(second.binders[0].manualOrder).toEqual(['nA2', 'back']);
  });

  it('backfills manualKeys from current ids on a legacy binder (no shadow yet)', () => {
    const b = binder({ manualOrder: ['c1', 'c2'] }); // no manualKeys
    const cards = [card('c1', 'sf1', 'nonfoil'), card('c2', 'sf2', 'foil')];

    const { binders, changed } = reconcileBinderRefs([b], cards, cards);

    expect(changed).toBe(true);
    expect(binders[0].manualKeys).toEqual(['sf1:nonfoil', 'sf2:foil']);
    expect(binders[0].manualOrder).toEqual(['c1', 'c2']); // ids unchanged in-session
  });

  it('is a no-op (same reference) when ordered ids still resolve', () => {
    const b = binder({ manualOrder: ['c1'], manualKeys: ['sf1:nonfoil'] });
    const cards = [card('c1', 'sf1', 'nonfoil')];

    const { binders, changed } = reconcileBinderRefs([b], cards, cards);

    expect(changed).toBe(false);
    expect(binders[0]).toBe(b);
  });
});

describe('addRef / removeRef — orphan-key preservation (the keysForIds regression)', () => {
  it('keeps an orphan-retained pin when an unrelated card is pinned afterwards', () => {
    // Binder pins K1 (owned) and K2 (NOT owned — orphan-retained intent).
    // Length of pinnedCopyIds (1) != pinnedKeys (2): the exact divergence the
    // old keysForIds positional fallback gave up on, silently dropping K2.
    const prevKeys = ['sf1:nonfoil', 'sfGone:nonfoil'];
    const prevIds = ['a']; // only the K1 copy is currently bound
    const cards = [card('a', 'sf1', 'nonfoil'), card('b', 'sf3', 'nonfoil')];

    const { keys, ids } = addRef(prevKeys, prevIds, 'b', cards);

    // K2 (sfGone) survived; K3 appended; K1 still bound.
    expect(keys).toEqual(['sf1:nonfoil', 'sfGone:nonfoil', 'sf3:nonfoil']);
    expect(new Set(ids)).toEqual(new Set(['a', 'b']));

    // And it actually comes back when the printing is re-imported.
    const back = reconcileBinderRefs(
      [binder({ pinnedKeys: keys, pinnedCopyIds: ids })],
      [card('a2', 'sf1'), card('b2', 'sf3'), card('g2', 'sfGone')],
      cards
    );
    expect(new Set(back.binders[0].pinnedCopyIds)).toEqual(new Set(['a2', 'b2', 'g2']));
  });

  it('removeRef drops one occurrence of the removed copy’s key, keeping orphans', () => {
    const prevKeys = ['sf1:nonfoil', 'sf1:nonfoil', 'sfGone:nonfoil'];
    const prevIds = ['a1', 'a2'];
    const cards = [card('a1', 'sf1'), card('a2', 'sf1')];

    const { keys, ids } = removeRef(prevKeys, prevIds, 'a1', cards);

    expect(keys).toEqual(['sf1:nonfoil', 'sfGone:nonfoil']); // one K1 + orphan kept
    expect(ids).toEqual(['a2']);
  });

  it('addRef no-ops when the added copy is not currently owned', () => {
    const r = addRef(['sf1:nonfoil'], ['x'], 'ghost', [card('x', 'sf1')]);
    expect(r.keys).toEqual(['sf1:nonfoil']);
    expect(r.ids).toEqual(['x']);
  });

  it('setOrderRefs mirrors the given order 1:1 into keys', () => {
    const cards = [card('p', 'sf2'), card('q', 'sf1')];
    const r = setOrderRefs(['p', 'q'], cards);
    expect(r.ids).toEqual(['p', 'q']);
    expect(r.keys).toEqual(['sf2:nonfoil', 'sf1:nonfoil']);
  });
});

describe('property: arbitrary pin/unpin/reimport sequences never silently drop a key', () => {
  it('pinnedKeys multiset == an independent model across 400 random ops', () => {
    // Deterministic LCG so failures reproduce.
    let seed = 0x9e3779b1 >>> 0;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];

    const PRINTINGS = ['A', 'B', 'C', 'D'];
    const sorted = (a: readonly string[]) => [...a].sort();
    let uid = 0;
    const build = (counts: Record<string, number>): EnrichedCard[] => {
      const out: EnrichedCard[] = [];
      for (const p of PRINTINGS)
        for (let i = 0; i < (counts[p] ?? 0); i++) out.push(card(`c${uid++}`, p));
      return out;
    };

    let counts: Record<string, number> = { A: 2, B: 1, C: 3, D: 0 };
    let cards = build(counts);
    let b = binder({ pinnedCopyIds: [], pinnedKeys: [] });
    const model: string[] = []; // durable key multiset, maintained independently

    const keyOf = (id: string) => {
      const c = cards.find((x) => x.copyId === id)!;
      return `${c.scryfallId}:nonfoil`;
    };

    for (let step = 0; step < 400; step++) {
      const op = Math.floor(rnd() * 3);
      if (op === 0) {
        // pin: a random owned copy not already pinned
        const free = cards.filter((c) => !(b.pinnedCopyIds ?? []).includes(c.copyId));
        if (free.length) {
          const id = pick(free).copyId;
          const r = addRef(b.pinnedKeys, b.pinnedCopyIds, id, cards);
          model.push(keyOf(id));
          b = { ...b, pinnedCopyIds: r.ids, pinnedKeys: r.keys };
        }
      } else if (op === 1) {
        // unpin: a random currently-bound copy
        const pinned = b.pinnedCopyIds ?? [];
        if (pinned.length) {
          const id = pick(pinned);
          const k = keyOf(id);
          const r = removeRef(b.pinnedKeys, b.pinnedCopyIds, id, cards);
          model.splice(model.indexOf(k), 1);
          b = { ...b, pinnedCopyIds: r.ids, pinnedKeys: r.keys };
        }
      } else {
        // reimport: brand-new copyIds, possibly different owned multiset
        const next: Record<string, number> = {};
        for (const p of PRINTINGS) next[p] = Math.floor(rnd() * 4); // 0..3, D can orphan
        const oldCards = cards;
        counts = next;
        cards = build(counts);
        const res = reconcileBinderRefs([b], cards, oldCards);
        b = res.binders[0];
      }

      // Invariant 1: durable intent is never silently lost or invented.
      expect(sorted(b.pinnedKeys ?? [])).toEqual(sorted(model));
      // Invariant 2: every bound id is a distinct, currently-owned copy.
      const pinned = b.pinnedCopyIds ?? [];
      expect(new Set(pinned).size).toBe(pinned.length);
      for (const id of pinned) expect(cards.some((c) => c.copyId === id)).toBe(true);
      // Invariant 3: each printing binds exactly min(intent, owned) copies.
      for (const p of PRINTINGS) {
        const want = model.filter((k) => k === `${p}:nonfoil`).length;
        const own = counts[p] ?? 0;
        const got = pinned.filter((id) => keyOf(id) === `${p}:nonfoil`).length;
        expect(got).toBe(Math.min(want, own));
      }
    }
  });
});
