import { describe, it, expect } from 'vitest';
import {
  pickPrice,
  buildEditedCards,
  isNoOpCardEdit,
  stackCopies,
  stackDetailMix,
} from './edit-card';
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

describe('stackDetailMix', () => {
  it('reports no mixed fields when the stack is uniform', () => {
    const copies = [
      enriched({ copyId: 'a', condition: 'nm', language: 'en' }),
      enriched({ copyId: 'b', condition: 'nm', language: 'en' }),
    ];
    expect(stackDetailMix(copies)).toEqual({ condition: undefined, language: undefined });
  });

  it('summarizes a non-uniform field with per-value counts, leaving an agreeing field out', () => {
    const copies = [
      enriched({ copyId: 'a', condition: 'nm', language: 'en' }),
      enriched({ copyId: 'b', condition: 'nm', language: 'en' }),
      enriched({ copyId: 'c', condition: 'nm', language: 'en' }),
      enriched({ copyId: 'd', condition: 'hp', language: 'en' }),
    ];
    expect(stackDetailMix(copies)).toEqual({ condition: '3 NM, 1 HP', language: undefined });
  });

  it('treats an unset condition/language as its own bucket', () => {
    const copies = [
      enriched({ copyId: 'a', condition: 'nm' }),
      enriched({ copyId: 'b', condition: undefined }),
    ];
    expect(stackDetailMix(copies).condition).toBe('1 NM, 1 Not set');
  });
});

describe('stackCopies', () => {
  it('matches on scryfallId + finish, the same key buildEditedCards edits by', () => {
    const a = enriched({ copyId: 'a', scryfallId: 'old', finish: 'nonfoil' });
    const b = enriched({ copyId: 'b', scryfallId: 'old', finish: 'foil' });
    const c = enriched({ copyId: 'c', scryfallId: 'other', finish: 'nonfoil' });
    expect(stackCopies([a, b, c], a)).toEqual([a]);
  });
});

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

  it('applies altered/proxy/misprint flags to every touched copy', () => {
    const editing = enriched({ copyId: 'copy-a' });
    const next = buildEditedCards(
      editing,
      selection({ quantity: 2, details: { altered: true, misprint: true } }),
      [editing]
    );
    expect(next).toHaveLength(2);
    expect(next.every((c) => c.altered === true && c.misprint === true)).toBe(true);
    expect(next.every((c) => c.proxy === undefined)).toBe(true);
  });

  it('clears flags when details is present with the flag keys missing', () => {
    const editing = enriched({ copyId: 'copy-a', altered: true, proxy: true, misprint: true });
    const next = buildEditedCards(editing, selection({ details: {} }), [editing]);
    expect(next[0].altered).toBeUndefined();
    expect(next[0].proxy).toBeUndefined();
    expect(next[0].misprint).toBeUndefined();
  });

  it('leaves flags untouched when details is absent (printing-only edit)', () => {
    const editing = enriched({ copyId: 'copy-a', proxy: true });
    const next = buildEditedCards(editing, selection({}), [editing]);
    expect(next[0].proxy).toBe(true);
  });

  it('uniform stack: condition/language are always applied regardless of touched flags (byte-identical pre-mixed-detection behavior)', () => {
    const a = enriched({ copyId: 'a', condition: 'nm', language: 'en' });
    const b = enriched({ copyId: 'b', condition: 'nm', language: 'en' });
    const next = buildEditedCards(a, selection({ details: { condition: 'lp', language: 'ja' } }), [
      a,
      b,
    ]);
    expect(next.every((c) => c.condition === 'lp' && c.language === 'ja')).toBe(true);
  });

  it('mixed stack + quantity bump: surviving copies keep their own condition/language when the field is untouched', () => {
    const a = enriched({ copyId: 'a', condition: 'nm', language: 'en' });
    const b = enriched({ copyId: 'b', condition: 'hp', language: 'en' });
    const next = buildEditedCards(
      a,
      selection({
        quantity: 3,
        details: { conditionTouched: false, languageTouched: false },
      }),
      [a, b]
    );

    expect(next).toHaveLength(3);
    expect(next.find((c) => c.copyId === 'a')?.condition).toBe('nm');
    expect(next.find((c) => c.copyId === 'b')?.condition).toBe('hp');
    // The fresh copy has no prior identity to preserve — it inherits the
    // representative (editingCard) copy's own condition, same as any other add.
    const fresh = next.find((c) => c.copyId !== 'a' && c.copyId !== 'b');
    expect(fresh?.condition).toBe('nm');
  });

  it('mixed stack + explicit condition change: every copy gets the new value', () => {
    const a = enriched({ copyId: 'a', condition: 'nm' });
    const b = enriched({ copyId: 'b', condition: 'hp' });
    const next = buildEditedCards(
      a,
      selection({ details: { condition: 'lp', conditionTouched: true } }),
      [a, b]
    );
    expect(next.every((c) => c.condition === 'lp')).toBe(true);
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

describe('isNoOpCardEdit', () => {
  it('is true when the selection is identical to the card (same printing/finish/qty, no details)', () => {
    const editing = enriched({ copyId: 'copy-a', scryfallId: 'sc1', finish: 'nonfoil' });
    const same = selection({ card: sc({ usd: '2.00' }), finish: 'nonfoil', quantity: 3 });
    expect(isNoOpCardEdit(editing, same, 3)).toBe(true);
  });

  it('is false when the printing changed', () => {
    const editing = enriched({ copyId: 'copy-a', scryfallId: 'old', finish: 'nonfoil' });
    const changed = selection({ finish: 'nonfoil' }); // sc() id is 'sc1' !== 'old'
    expect(isNoOpCardEdit(editing, changed, 1)).toBe(false);
  });

  it('is false when the finish changed', () => {
    const editing = enriched({ copyId: 'copy-a', scryfallId: 'sc1', finish: 'nonfoil' });
    const changed = selection({ finish: 'foil' });
    expect(isNoOpCardEdit(editing, changed, 1)).toBe(false);
  });

  it('is false when quantity changed (whole-stack edit)', () => {
    const editing = enriched({ copyId: 'copy-a', scryfallId: 'sc1', finish: 'nonfoil' });
    const changed = selection({ finish: 'nonfoil', quantity: 4 });
    expect(isNoOpCardEdit(editing, changed, 3)).toBe(false);
  });

  it('ignores quantity in single-copy mode (copyId given)', () => {
    const editing = enriched({ copyId: 'copy-a', scryfallId: 'sc1', finish: 'nonfoil' });
    const changed = selection({ finish: 'nonfoil', quantity: 5 });
    expect(isNoOpCardEdit(editing, changed, 3, 'copy-a')).toBe(true);
  });

  it('is false when details (condition/language/flags) changed', () => {
    const editing = enriched({ copyId: 'copy-a', scryfallId: 'sc1', finish: 'nonfoil' });
    expect(
      isNoOpCardEdit(editing, selection({ finish: 'nonfoil', details: { condition: 'lp' } }), 1)
    ).toBe(false);
  });

  it('is true when details are given but match the card exactly', () => {
    const editing = enriched({
      copyId: 'copy-a',
      scryfallId: 'sc1',
      finish: 'nonfoil',
      condition: 'nm',
      language: 'en',
    });
    expect(
      isNoOpCardEdit(
        editing,
        selection({ finish: 'nonfoil', details: { condition: 'nm', language: 'en' } }),
        1
      )
    ).toBe(true);
  });
});
