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
import type { EnrichedCard } from '@/types/index';

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

  // E122: Considering exports as "Maybeboard" — the ecosystem's de-facto
  // text-format header (Moxfield/Archidekt/MTGGoldfish), matching what
  // parsers/text.ts's SECTION_HEADERS already recognizes on the way back in.
  it('omits the Maybeboard section entirely when considering is empty', () => {
    const result = buildExport({ cards: [{ card: card() }], considering: [] }, 'plain');
    expect(result).not.toContain('Maybeboard');
  });

  it('labels the considering section "Maybeboard", after Sideboard, when both are present', () => {
    const result = buildExport(
      {
        cards: [{ card: card({ name: 'Sol Ring' }) }],
        sideboard: [{ card: card({ name: 'Negate', set: 'znr', collector_number: '50' }) }],
        considering: [{ card: card({ name: 'Rhystic Study', set: 'thb', collector_number: '9' }) }],
      },
      'plain'
    );
    expect(result.split('\n')).toEqual([
      '1 Sol Ring (CMR) 472',
      '',
      'Sideboard',
      '1 Negate (ZNR) 50',
      '',
      'Maybeboard',
      '1 Rhystic Study (THB) 9',
    ]);
  });
});

describe('mtgo export (.dek XML)', () => {
  it('emits the XML declaration and Deck root with NetDeckID/PreconstructedDeckID', () => {
    const result = buildExport({ cards: [{ card: card() }] }, 'mtgo');
    const lines = result.split('\n');
    expect(lines[0]).toBe('<?xml version="1.0" encoding="utf-8"?>');
    expect(lines[1]).toContain('<Deck xmlns:xsi=');
    expect(lines[1]).toContain('xmlns:xsd=');
    expect(lines).toContain('<NetDeckID>0</NetDeckID>');
    expect(lines).toContain('<PreconstructedDeckID>0</PreconstructedDeckID>');
    expect(lines[lines.length - 1]).toBe('</Deck>');
  });

  it('puts mainboard cards as Sideboard="false" Cards tags with CatID/Quantity/Name', () => {
    const result = buildExport(
      { cards: [{ card: card({ name: 'Sol Ring' }) }, { card: card({ name: 'Sol Ring' }) }] },
      'mtgo'
    );
    expect(result).toContain('<Cards CatID="0" Quantity="2" Sideboard="false" Name="Sol Ring"/>');
  });

  it('puts the commander (and partner) in the main list, not a separate section', () => {
    const result = buildExport(
      {
        commander: card({ name: 'Kaalia of the Vast' }),
        partner: card({ name: 'Thrasios, Triton Hero' }),
        cards: [{ card: card({ name: 'Sol Ring' }) }],
      },
      'mtgo'
    );
    expect(result).not.toContain('Commander');
    expect(result).toContain(
      '<Cards CatID="0" Quantity="1" Sideboard="false" Name="Kaalia of the Vast"/>'
    );
    expect(result).toContain(
      '<Cards CatID="0" Quantity="1" Sideboard="false" Name="Thrasios, Triton Hero"/>'
    );
  });

  it('marks sideboard cards Sideboard="true"', () => {
    const result = buildExport(
      {
        cards: [{ card: card({ name: 'Sol Ring' }) }],
        sideboard: [{ card: card({ name: 'Negate', set: 'znr', collector_number: '50' }) }],
      },
      'mtgo'
    );
    expect(result).toContain('<Cards CatID="0" Quantity="1" Sideboard="true" Name="Negate"/>');
    expect(result).toContain('<Cards CatID="0" Quantity="1" Sideboard="false" Name="Sol Ring"/>');
  });

  it('drops considering (no Maybeboard equivalent in the MTGO format)', () => {
    const result = buildExport(
      {
        cards: [{ card: card({ name: 'Sol Ring' }) }],
        considering: [{ card: card({ name: 'Rhystic Study' }) }],
      },
      'mtgo'
    );
    expect(result).not.toContain('Rhystic Study');
  });

  it('escapes XML entities in card names', () => {
    const result = buildExport(
      { cards: [{ card: card({ name: 'Who/What/When/Where/Why <Foo> & "Bar"' }) }] },
      'mtgo'
    );
    expect(result).toContain('Name="Who/What/When/Where/Why &lt;Foo&gt; &amp; &quot;Bar&quot;"');
    expect(result).not.toContain('<Foo>');
  });
});
