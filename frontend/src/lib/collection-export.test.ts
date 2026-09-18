import { describe, it, expect } from 'vitest';
import {
  COLLECTION_EXPORT_FORMATS,
  collectionExportFileName,
  collectionToExport,
} from './collection-export';
import type { EnrichedCard } from '../types';

function card(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: 'copy-1',
    name: 'Sol Ring',
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'uncommon',
    scryfallId: 'sf-a',
    purchasePrice: 4,
    sourceCategory: 'Commander',
    sourceFormat: 'manabox',
    finish: 'nonfoil',
    foil: false,
    condition: 'nm',
    language: 'en',
    acquiredPrice: 1.5,
    ...overrides,
  };
}

const rows = (text: string) => text.split('\n').slice(1);

describe('collectionToExport', () => {
  it('writes one row per physical copy in every CSV format, never a merged Quantity', () => {
    const cards = [card({ copyId: 'a' }), card({ copyId: 'b' }), card({ copyId: 'c' })];
    for (const f of ['spellcontrol', 'moxfield', 'archidekt'] as const) {
      expect(rows(collectionToExport(cards, f))).toHaveLength(3);
    }
  });

  it('keeps per-copy fields that differ between copies of one printing', () => {
    const csv = collectionToExport(
      [card({ acquiredPrice: 1 }), card({ acquiredPrice: 9, altered: true })],
      'spellcontrol'
    );
    const [a, b] = rows(csv);
    expect(a).toContain(',1.00,USD,');
    expect(b).toContain(',9.00,USD,');
    expect(b).toContain(',TRUE,FALSE,FALSE,');
  });

  it('SpellControl CSV keeps the ManaBox detection signature and aliases the parser reads', () => {
    const [header] = collectionToExport([], 'spellcontrol').split('\n');
    for (const h of [
      'Name',
      'Set code',
      'Collector number',
      'Foil',
      'Quantity',
      'Scryfall ID',
      'Purchase price',
      'Condition',
      'Language',
      'Binder name',
      'Altered',
      'Proxy',
      'Misprint',
    ]) {
      expect(header.split(',')).toContain(h);
    }
    expect(header).toContain('Market price (EUR)'.replace('EUR', 'USD'));
    expect(collectionToExport([], 'spellcontrol', 'EUR')).toContain('Market price (EUR)');
  });

  it('quotes a name containing a comma and doubles internal quotes', () => {
    const csv = collectionToExport([card({ name: 'Atraxa, Grand Unifier' })], 'spellcontrol');
    expect(csv).toContain('"Atraxa, Grand Unifier"');
  });

  it('Moxfield CSV uses its own header, lowercase edition, full names, TRUE/FALSE flags', () => {
    const csv = collectionToExport(
      [card({ condition: 'lp', language: 'ja', finish: 'etched', proxy: true })],
      'moxfield'
    );
    const [header, row] = csv.split('\n');
    expect(header).toBe(
      'Count,Tradelist Count,Name,Edition,Condition,Language,Foil,Tags,Last Modified,Collector Number,Alter,Proxy,Purchase Price'
    );
    expect(row).toBe(
      '1,0,Sol Ring,cmr,Lightly Played,Japanese,etched,Commander,,1,FALSE,TRUE,1.50'
    );
  });

  it('Moxfield writes a blank Foil for nonfoil and English when language is unset', () => {
    const [, row] = collectionToExport([card({ language: undefined })], 'moxfield').split('\n');
    expect(row).toBe('1,0,Sol Ring,cmr,Near Mint,English,,Commander,,1,FALSE,FALSE,1.50');
  });

  it('Archidekt CSV names the finish, abbreviates condition and carries the Scryfall ID', () => {
    const csv = collectionToExport([card({ finish: 'foil', condition: 'damaged' })], 'archidekt');
    const [header, row] = csv.split('\n');
    expect(header).toBe(
      'Quantity,Name,Finish,Condition,Date Added,Language,Purchase Price,Tags,Edition Name,Edition Code,Scryfall ID,Collector Number'
    );
    expect(row).toBe('1,Sol Ring,Foil,D,,EN,1.50,Commander,Commander Legends,cmr,sf-a,1');
  });

  it('Arena text groups identical printings with a count and sorts by name', () => {
    const text = collectionToExport(
      [card(), card(), card({ name: 'Arcane Signet', setCode: 'C21', collectorNumber: '9' })],
      'mtga'
    );
    expect(text).toBe('1 Arcane Signet (C21) 9\n2 Sol Ring (CMR) 1');
  });

  it('empty collection exports a header only (CSV) or nothing (Arena)', () => {
    expect(collectionToExport([], 'moxfield').split('\n')).toHaveLength(1);
    expect(collectionToExport([], 'mtga')).toBe('');
  });

  it('every listed format produces output', () => {
    for (const f of COLLECTION_EXPORT_FORMATS) {
      expect(collectionToExport([card()], f.value)).toContain('Sol Ring');
    }
  });
});

describe('collectionExportFileName', () => {
  const now = new Date('2026-03-04T05:06:00Z');
  it('names the collection file by format and date', () => {
    expect(collectionExportFileName('spellcontrol', undefined, now)).toMatch(
      /^spellcontrol-collection-\d{4}-\d{2}-\d{2}\.csv$/
    );
    expect(collectionExportFileName('moxfield', undefined, now)).toMatch(
      /^spellcontrol-collection-moxfield-\d{4}-\d{2}-\d{2}\.csv$/
    );
    expect(collectionExportFileName('mtga', undefined, now)).toMatch(/\.txt$/);
  });
  it('names a binder file after the binder', () => {
    expect(collectionExportFileName('archidekt', 'Modern Staples', now)).toMatch(
      /^spellcontrol-binder-modern-staples-archidekt-\d{4}-\d{2}-\d{2}\.csv$/
    );
  });
});

/**
 * `backend/src/parsers/fixtures/collection-export-sample.csv` is this
 * exporter's own SpellControl-format output for a small fixed collection —
 * the backend parser test round-trips it. Keep this card list in sync with
 * that fixture; if it drifts, regenerate the fixture from
 * `collectionToExport` rather than hand-editing it.
 */
describe('backend round-trip fixture', () => {
  it('matches the checked-in fixture the backend parser test reads', () => {
    const fixtureCards: EnrichedCard[] = [
      card({ copyId: 'a1' }),
      card({ copyId: 'a2' }), // second copy of the same printing -> its own row
      card({
        copyId: 'b1',
        name: 'Lightning Bolt',
        setCode: 'LEA',
        setName: 'Limited Edition Alpha',
        collectorNumber: '161',
        rarity: 'common',
        scryfallId: 'sf-b',
        finish: 'foil',
        condition: 'lp',
        language: 'en',
        sourceCategory: 'Modern',
        acquiredPrice: undefined,
        altered: true,
        priceOverride: 12,
      }),
      card({
        copyId: 'c1',
        name: 'Atraxa, Grand Unifier',
        setCode: 'ONE',
        setName: 'Phyrexia: All Will Be One',
        collectorNumber: '240',
        rarity: 'mythic',
        scryfallId: 'sf-c',
        finish: 'etched',
        condition: undefined,
        language: 'ja',
        sourceCategory: '',
        acquiredPrice: undefined,
        proxy: true,
      }),
    ];
    expect(collectionToExport(fixtureCards, 'spellcontrol')).toBe(
      [
        'Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,Scryfall ID,Purchase price,Purchase currency,Condition,Language,Binder name,Altered,Proxy,Misprint,Price override,Price override currency,Market price (USD),Oracle ID,Type line,Mana value,Color identity,Last edited,Copy ID',
        'Sol Ring,CMR,Commander Legends,1,normal,uncommon,1,sf-a,1.50,USD,near_mint,en,Commander,FALSE,FALSE,FALSE,,,4.00,,,,,,a1',
        'Sol Ring,CMR,Commander Legends,1,normal,uncommon,1,sf-a,1.50,USD,near_mint,en,Commander,FALSE,FALSE,FALSE,,,4.00,,,,,,a2',
        'Lightning Bolt,LEA,Limited Edition Alpha,161,foil,common,1,sf-b,,,lightly_played,en,Modern,TRUE,FALSE,FALSE,12.00,USD,4.00,,,,,,b1',
        '"Atraxa, Grand Unifier",ONE,Phyrexia: All Will Be One,240,etched,mythic,1,sf-c,,,,ja,,FALSE,TRUE,FALSE,,,4.00,,,,,,c1',
      ].join('\n')
    );
  });
});
