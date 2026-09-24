import { describe, expect, it } from 'vitest';
import { summarizeCardUse } from './card-use';

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
      [{ id: 'private', data: { commanderAllocatedCopyId: 'a1', cards: [] } }],
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
        card('f1', 'forest', { typeLine: 'Basic Land — Forest' }),
        card('f2', 'forest', { typeLine: 'Basic Land — Forest' }),
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
