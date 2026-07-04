import { describe, it, expect } from 'vitest';
import { pickPrice, buildEditedCards } from './edit-card';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '../types';
import type { PrintingSelection } from '../components/CardEditDialog';

const sc = (prices: Record<string, string | null>): ScryfallCard =>
  ({
    id: 'sc1',
    name: 'Sol Ring',
    set: 'c21',
    set_name: 'Commander 2021',
    collector_number: '263',
    rarity: 'uncommon',
    prices,
  }) as unknown as ScryfallCard;

describe('pickPrice', () => {
  it('biases by finish: foil prefers usd_foil, nonfoil prefers usd', () => {
    const card = sc({ usd: '1.50', usd_foil: '5.00', usd_etched: null });
    expect(pickPrice(card, true)).toBe(5);
    expect(pickPrice(card, false)).toBe(1.5);
  });

  it('falls through to etched then the other finish', () => {
    expect(pickPrice(sc({ usd: null, usd_foil: null, usd_etched: '3.25' }), true)).toBe(3.25);
    expect(pickPrice(sc({ usd: null, usd_foil: '9.00', usd_etched: null }), false)).toBe(9);
  });

  it('returns 0 when no positive finite price exists', () => {
    expect(pickPrice(sc({ usd: '0', usd_foil: null, usd_etched: 'nan' }), false)).toBe(0);
    expect(pickPrice({ prices: undefined } as unknown as ScryfallCard, true)).toBe(0);
  });
});

const enriched = (over: Partial<EnrichedCard>): EnrichedCard =>
  ({
    copyId: 'copy-a',
    scryfallId: 'old',
    name: 'Sol Ring',
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'uncommon',
    finish: 'nonfoil',
    foil: false,
    purchasePrice: 0,
    sourceCategory: 'main',
    sourceFormat: 'edhrec',
    importId: 'imp1',
    ...over,
  }) as unknown as EnrichedCard;

const selection = (over: Partial<PrintingSelection>): PrintingSelection =>
  ({ card: sc({ usd: '2.00' }), finish: 'nonfoil', ...over }) as PrintingSelection;

describe('buildEditedCards', () => {
  it('updates the matching copy in place, preserving copyId, and leaves others untouched', () => {
    const editing = enriched({ copyId: 'copy-a', scryfallId: 'old', finish: 'nonfoil' });
    const other = enriched({ copyId: 'copy-z', scryfallId: 'zzz', name: 'Island' });
    const next = buildEditedCards(editing, selection({}), [other, editing]);

    expect(next).toHaveLength(2);
    const updated = next.find((c) => c.copyId === 'copy-a');
    expect(updated?.scryfallId).toBe('sc1'); // re-pointed to the chosen printing
    expect(updated?.setCode).toBe('C21');
    expect(updated?.purchasePrice).toBe(2);
    expect(next.find((c) => c.copyId === 'copy-z')?.name).toBe('Island'); // other intact
  });

  it('adds fresh copies (new copyIds, original provenance) when quantity grows', () => {
    const editing = enriched({ copyId: 'copy-a' });
    const next = buildEditedCards(editing, selection({ quantity: 3 }), [editing]);

    expect(next).toHaveLength(3);
    expect(next.filter((c) => c.copyId === 'copy-a')).toHaveLength(1);
    const fresh = next.filter((c) => c.copyId !== 'copy-a');
    expect(fresh).toHaveLength(2);
    expect(new Set(next.map((c) => c.copyId)).size).toBe(3); // all unique
    expect(fresh.every((c) => c.sourceFormat === 'edhrec' && c.importId === 'imp1')).toBe(true);
  });

  it('drops surplus copies when quantity shrinks', () => {
    const a = enriched({ copyId: 'a' });
    const b = enriched({ copyId: 'b' });
    const c = enriched({ copyId: 'c' });
    const next = buildEditedCards(a, selection({ quantity: 1 }), [a, b, c]);
    expect(next).toHaveLength(1);
    expect(next[0].copyId).toBe('a');
  });

  it('applies condition/language to every touched copy, including fresh adds', () => {
    const editing = enriched({ copyId: 'copy-a', condition: 'nm' });
    const next = buildEditedCards(
      editing,
      selection({ quantity: 2, details: { condition: 'lp', language: 'ja' } }),
      [editing]
    );

    expect(next).toHaveLength(2);
    expect(next.every((c) => c.condition === 'lp' && c.language === 'ja')).toBe(true);
  });

  it('clears condition/language when details is present with missing keys', () => {
    const editing = enriched({ copyId: 'copy-a', condition: 'hp', language: 'de' });
    const next = buildEditedCards(editing, selection({ details: {} }), [editing]);
    expect(next[0].condition).toBeUndefined();
    expect(next[0].language).toBeUndefined();
  });

  it('leaves condition/language untouched when details is absent (printing-only edit)', () => {
    const editing = enriched({ copyId: 'copy-a', condition: 'mp', language: 'fr' });
    const next = buildEditedCards(editing, selection({}), [editing]);
    expect(next[0].condition).toBe('mp');
    expect(next[0].language).toBe('fr');
  });

  it('single-copy mode re-points only the given copy, splitting a printing stack', () => {
    // Two copies of the same printing; edit just one to a different printing.
    const a = enriched({ copyId: 'a', scryfallId: 'old' });
    const b = enriched({ copyId: 'b', scryfallId: 'old' });
    const next = buildEditedCards(a, selection({ quantity: 5 }), [a, b], 'a');

    expect(next).toHaveLength(2); // no copies added/dropped — quantity ignored
    expect(next.find((c) => c.copyId === 'a')?.scryfallId).toBe('sc1'); // split off
    expect(next.find((c) => c.copyId === 'a')?.setCode).toBe('C21');
    expect(next.find((c) => c.copyId === 'b')?.scryfallId).toBe('old'); // sibling untouched
  });
});
