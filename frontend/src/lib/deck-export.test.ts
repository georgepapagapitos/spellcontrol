import { describe, it, expect } from 'vitest';
import {
  formatLine,
  resolvePrinting,
  groupAndSort,
  buildExport,
  type ExportEntry,
  type ExportableCard,
  type ExportCardSlot,
} from './deck-export';
import type { EnrichedCard } from '../types';

function entry(overrides: Partial<ExportEntry> = {}): ExportEntry {
  return {
    name: 'Sol Ring',
    set: 'cmr',
    collectorNumber: '472',
    qty: 1,
    finish: 'nonfoil',
    ...overrides,
  };
}

function card(overrides: Partial<ExportableCard> = {}): ExportableCard {
  return { name: 'Sol Ring', set: 'cmr', collector_number: '472', ...overrides };
}

function copy(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: 'copy-1',
    name: 'Sol Ring',
    setCode: 'lea',
    setName: 'Limited Edition Alpha',
    collectorNumber: '1',
    rarity: 'uncommon',
    scryfallId: 'sf-1',
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'manabox',
    finish: 'nonfoil',
    foil: false,
    ...overrides,
  };
}

describe('formatLine', () => {
  it('mtga: appends (SET) collector-number when a printing is known', () => {
    expect(formatLine(entry(), 'mtga')).toBe('1 Sol Ring (CMR) 472');
  });

  it('mtga: falls back to bare qty+name with no set/collector-number', () => {
    expect(formatLine(entry({ set: '', collectorNumber: '' }), 'mtga')).toBe('1 Sol Ring');
  });

  it('moxfield: tags foil as *F* and etched as *E*, nothing for nonfoil', () => {
    expect(formatLine(entry({ finish: 'foil' }), 'moxfield')).toBe('1 Sol Ring (CMR) 472 *F*');
    expect(formatLine(entry({ finish: 'etched' }), 'moxfield')).toBe('1 Sol Ring (CMR) 472 *E*');
    expect(formatLine(entry({ finish: 'nonfoil' }), 'moxfield')).toBe('1 Sol Ring (CMR) 472');
  });

  it('plain: appends [Foil]/[Etched] and an uppercased non-English language tag', () => {
    expect(formatLine(entry({ finish: 'foil' }), 'plain')).toBe('1 Sol Ring (CMR) 472 [Foil]');
    expect(formatLine(entry({ finish: 'etched' }), 'plain')).toBe('1 Sol Ring (CMR) 472 [Etched]');
    expect(formatLine(entry({ language: 'ja' }), 'plain')).toBe('1 Sol Ring (CMR) 472 [JA]');
    // English is the assumed default — no redundant [EN] tag.
    expect(formatLine(entry({ language: 'en' }), 'plain')).toBe('1 Sol Ring (CMR) 472');
  });
});

describe('resolvePrinting', () => {
  const collectionByCopyId = new Map<string, EnrichedCard>([
    ['copy-1', copy({ setCode: 'lea', collectorNumber: '1', finish: 'foil', language: 'ja' })],
  ]);

  it('an allocated collection copy wins over the slot card', () => {
    const result = resolvePrinting(card(), 'copy-1', collectionByCopyId);
    expect(result).toEqual({
      name: 'Sol Ring',
      set: 'lea',
      collectorNumber: '1',
      finish: 'foil',
      language: 'ja',
    });
  });

  it('falls back to the slot card when unallocated, defaulting finish to nonfoil', () => {
    const result = resolvePrinting(card(), null, collectionByCopyId);
    expect(result).toEqual({
      name: 'Sol Ring',
      set: 'cmr',
      collectorNumber: '472',
      finish: 'nonfoil',
    });
  });

  it('falls back to the slot card when the allocated copy is not in the map', () => {
    const result = resolvePrinting(card(), 'missing-copy', collectionByCopyId);
    expect(result).toEqual({
      name: 'Sol Ring',
      set: 'cmr',
      collectorNumber: '472',
      finish: 'nonfoil',
    });
  });
});

describe('groupAndSort', () => {
  it('collapses two identical-printing slots into one qty-2 entry', () => {
    const slots: ExportCardSlot[] = [{ card: card() }, { card: card() }];
    const result = groupAndSort(slots);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: 'Sol Ring',
      set: 'cmr',
      collectorNumber: '472',
      qty: 2,
    });
  });

  it('sorts by name, then set, then collector number, then finish', () => {
    const slots: ExportCardSlot[] = [
      { card: card({ name: 'Zap', set: 'lea', collector_number: '5' }) },
      { card: card({ name: 'Ana', set: 'znr', collector_number: '1' }) },
      { card: card({ name: 'Ana', set: 'lea', collector_number: '2' }) },
      { card: card({ name: 'Ana', set: 'lea', collector_number: '1' }) },
    ];
    const result = groupAndSort(slots);
    expect(result.map((e) => `${e.name}|${e.set}|${e.collectorNumber}`)).toEqual([
      'Ana|lea|1',
      'Ana|lea|2',
      'Ana|znr|1',
      'Zap|lea|5',
    ]);
  });
});

describe('buildExport', () => {
  it('mtga: splits into Commander / blank line / Deck only when a commander is present', () => {
    const withCommander = buildExport(
      {
        commander: card({ name: 'Kaalia of the Vast' }),
        cards: [{ card: card({ name: 'Sol Ring' }) }],
      },
      'mtga'
    );
    expect(withCommander.split('\n')).toEqual([
      'Commander',
      '1 Kaalia of the Vast (CMR) 472',
      '',
      'Deck',
      '1 Sol Ring (CMR) 472',
    ]);

    const withoutCommander = buildExport({ cards: [{ card: card({ name: 'Sol Ring' }) }] }, 'mtga');
    expect(withoutCommander.split('\n')).toEqual(['1 Sol Ring (CMR) 472']);
  });

  it('omits the Sideboard section entirely when it is empty', () => {
    const result = buildExport({ cards: [{ card: card() }], sideboard: [] }, 'plain');
    expect(result).not.toContain('Sideboard');
  });

  it('resolves commander and partner each through their own allocated-copy id', () => {
    const collectionByCopyId = new Map<string, EnrichedCard>([
      ['cmdr-copy', copy({ name: 'Kaalia of the Vast', setCode: 'cmd', collectorNumber: '1' })],
      [
        'partner-copy',
        copy({ name: 'Tana, the Bloodsower', setCode: 'c16', collectorNumber: '2' }),
      ],
    ]);
    const result = buildExport(
      {
        commander: card({ name: 'Kaalia of the Vast' }),
        partner: card({ name: 'Tana, the Bloodsower' }),
        cards: [],
        collectionByCopyId,
        commanderAllocatedCopyId: 'cmdr-copy',
        partnerAllocatedCopyId: 'partner-copy',
      },
      'mtga'
    );
    expect(result.split('\n')).toEqual([
      'Commander',
      '1 Kaalia of the Vast (CMD) 1',
      '1 Tana, the Bloodsower (C16) 2',
      '',
      'Deck',
    ]);
  });

  it('produces correct output from the narrower ExportableCard shape with zero collection context', () => {
    // Mirrors the shared-view call site: PublicDeckCard['card'] slots, no
    // collectionByCopyId, no allocated-copy ids at all.
    const result = buildExport(
      {
        commander: card({ name: 'Kaalia of the Vast' }),
        cards: [{ card: card({ name: 'Sol Ring' }) }, { card: card({ name: 'Sol Ring' }) }],
        sideboard: [{ card: card({ name: 'Rampant Growth', set: 'znr', collector_number: '9' }) }],
      },
      'plain'
    );
    expect(result.split('\n')).toEqual([
      '1 Kaalia of the Vast (CMR) 472',
      '2 Sol Ring (CMR) 472',
      '',
      'Sideboard',
      '1 Rampant Growth (ZNR) 9',
    ]);
  });
});
