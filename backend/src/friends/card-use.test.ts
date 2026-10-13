import { describe, expect, it } from 'vitest';
import { computeSpareCopyIds, type EnrichedCard } from '@spellcontrol/binder-routing';
import { claimedCopyIds, summarizeCardUse } from './card-use';

const card = (id: string, oracleId: string, extra: Record<string, unknown> = {}) => ({
  id,
  data: { name: oracleId, oracleId, typeLine: 'Artifact', ...extra },
});
const slot = (oracleId: string, allocatedCopyId: string | null = null) => ({
  card: { oracle_id: oracleId, name: oracleId },
  allocatedCopyId,
});

describe('summarizeCardUse', () => {
  it('spare means a free copy past the kept one, the same rule as the owner’s "N free"', () => {
    const use = summarizeCardUse(
      [card('a1', 'sol'), card('a2', 'sol'), card('b1', 'rhystic'), card('c1', 'crypt')],
      [{ id: 'd1', data: { cards: [slot('crypt', 'c1')] } }],
      [],
      new Set()
    );
    expect(use.get('sol')?.spare).toBe(true);
    // One copy, unclaimed: it's the kept copy, not a spare.
    expect(use.get('rhystic')?.spare).toBe(false);
    expect(use.get('crypt')?.spare).toBe(false);
  });

  it('a copy claimed by a PRIVATE deck or a physical cube is not free', () => {
    const use = summarizeCardUse(
      [card('a1', 'sol'), card('a2', 'sol'), card('b1', 'ring'), card('b2', 'ring')],
      [
        {
          id: 'private',
          data: { commander: { oracle_id: 'sol' }, commanderAllocatedCopyId: 'a1', cards: [] },
        },
      ],
      [{ id: 'cube', data: { isPhysical: true, picks: [slot('ring', 'b1')] } }],
      new Set()
    );
    expect(use.get('sol')?.spare).toBe(false);
    expect(use.get('ring')?.spare).toBe(false);
  });

  it('a non-physical cube claims nothing', () => {
    const use = summarizeCardUse(
      [card('b1', 'ring'), card('b2', 'ring')],
      [],
      [{ id: 'cube', data: { isPhysical: false, picks: [slot('ring', 'b1')] } }],
      new Set()
    );
    expect(use.get('ring')?.spare).toBe(true);
  });

  it('never calls a proxy or a basic land spare', () => {
    const use = summarizeCardUse(
      [
        card('p1', 'lotus', { proxy: true }),
        card('p2', 'lotus', { proxy: true }),
        card('f1', 'forest', { name: 'Forest', typeLine: 'Basic Land — Forest' }),
        card('f2', 'forest', { name: 'Forest', typeLine: 'Basic Land — Forest' }),
      ],
      [],
      [],
      new Set()
    );
    expect(use.get('lotus')?.spare).toBe(false);
    expect(use.get('forest')?.spare).toBe(false);
  });

  it('names only VISIBLE decks, from the list rather than the bound copy', () => {
    const use = summarizeCardUse(
      [card('a1', 'sol'), card('k1', 'krenko')],
      [
        {
          id: 'public',
          data: { commander: { oracle_id: 'krenko' }, cards: [slot('sol')], considering: [] },
        },
        { id: 'private', data: { cards: [slot('sol', 'a1')] } },
        { id: 'maybe', data: { cards: [], considering: [slot('krenko')] } },
      ],
      [],
      new Set(['public', 'maybe'])
    );
    expect(use.get('sol')?.deckIds).toEqual(['public']);
    // "Considering" is not the deck.
    expect(use.get('krenko')?.deckIds).toEqual(['public']);
  });
});

// E542: the friend hub's spare flag must agree with the owner's own app, which
// reads computeSpareCopyIds. Same rows, both ways.
describe('summarizeCardUse agrees with the shared spare rule', () => {
  const rows = [
    // Sol Ring: main, considering, then a plain and a foil loose copy.
    card('ring-main', 'sol', { name: 'Sol Ring' }),
    card('ring-maybe', 'sol', { name: 'Sol Ring' }),
    card('ring-plain', 'sol', { name: 'Sol Ring' }),
    card('ring-foil', 'sol', { name: 'Sol Ring', finish: 'foil' }),
    // Arcane Signet: one in a physical cube, one loose.
    card('sig-cube', 'signet', { name: 'Arcane Signet' }),
    card('sig-loose', 'signet', { name: 'Arcane Signet' }),
    // Mana Crypt: two real, one proxy.
    card('crypt-1', 'crypt', { name: 'Mana Crypt' }),
    card('crypt-2', 'crypt', { name: 'Mana Crypt' }),
    card('crypt-proxy', 'crypt', { name: 'Mana Crypt', proxy: true }),
    // Rhystic Study: sideboard and loose.
    card('study-side', 'study', { name: 'Rhystic Study' }),
    card('study-loose', 'study', { name: 'Rhystic Study' }),
  ];
  const decks = [
    { id: 'a', data: { cards: [slot('sol', 'ring-main')] } },
    {
      id: 'b',
      data: {
        considering: [slot('sol', 'ring-maybe')],
        sideboard: [slot('study', 'study-side')],
      },
    },
  ];
  const cubes = [{ id: 'cube', data: { isPhysical: true, picks: [slot('signet', 'sig-cube')] } }];

  it('flags exactly the cards the client rule finds a spare copy of', () => {
    const copies = rows.map(
      (r) => ({ copyId: r.id, ...(r.data as object) }) as unknown as EnrichedCard
    );
    const spareIds = computeSpareCopyIds(copies, claimedCopyIds(decks, cubes));
    const expected = new Set(
      rows.filter((r) => spareIds.has(r.id)).map((r) => r.data.oracleId as string)
    );
    expect([...expected].sort()).toEqual(['crypt', 'sol']);

    const use = summarizeCardUse(rows, decks, cubes, new Set());
    for (const oracleId of ['sol', 'signet', 'crypt', 'study']) {
      expect(use.get(oracleId)?.spare, oracleId).toBe(expected.has(oracleId));
    }
  });

  it('a copy parked in considering or a sideboard is claimed, so it is not free', () => {
    expect([...claimedCopyIds(decks, cubes)].sort()).toEqual([
      'ring-main',
      'ring-maybe',
      'sig-cube',
      'study-side',
    ]);
  });
});
