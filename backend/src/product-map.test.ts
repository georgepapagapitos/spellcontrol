import { describe, expect, it } from 'vitest';
import {
  countPhysicalCards,
  productToDeckSections,
  productToExtraRows,
  productToPhysicalRows,
  type MtgjsonDeckFile,
} from './product-map';

// Trimmed fixture mirroring the real MTGJSON shape (see RainingCatsAndDogs_SLD):
// a commander, a mainBoard with a multi-copy basic land, plus the extra physical
// zones — a 3-card displayCommander and a token.
const fixture: MtgjsonDeckFile = {
  name: 'Test Precon',
  code: 'TST',
  type: 'Commander Deck',
  releaseDate: '2026-01-01',
  commander: [
    {
      count: 1,
      name: 'Rin and Seri, Inseparable // Rin and Seri, Inseparable',
      setCode: 'SLD',
      number: '1508',
      isFoil: true,
      identifiers: { scryfallId: 'cmdr-id' },
    },
  ],
  mainBoard: [
    {
      count: 1,
      name: 'Sol Ring',
      setCode: 'SLD',
      number: '200',
      isFoil: false,
      identifiers: { scryfallId: 'sol-id' },
    },
    {
      count: 10,
      name: 'Plains',
      setCode: 'SLD',
      number: '1513',
      isFoil: true,
      identifiers: { scryfallId: 'plains-id' },
    },
  ],
  sideBoard: [],
  displayCommander: [
    {
      count: 1,
      name: 'Rin and Seri, Inseparable // Rin and Seri, Inseparable',
      setCode: 'SLD',
      number: '1554',
      isFoil: false,
      identifiers: { scryfallId: 'disp-1' },
    },
    {
      count: 1,
      name: 'Jetmir, Nexus of Revels',
      setCode: 'SLD',
      number: '1555',
      isFoil: false,
      identifiers: { scryfallId: 'disp-2' },
    },
    {
      count: 1,
      name: 'Jinnie Fay, Jetmir’s Second',
      setCode: 'SLD',
      number: '1556',
      isFoil: false,
      identifiers: { scryfallId: 'disp-3' },
    },
  ],
  tokens: [
    {
      count: 1,
      name: 'Cat',
      setCode: 'TSLD',
      number: '1',
      isFoil: false,
      identifiers: { scryfallId: 'tok-1' },
    },
  ],
};

describe('productToDeckSections', () => {
  it('maps commander + mainBoard to the playable deck, never the extras', () => {
    const { commanderRows, companionRows, deckRows } = productToDeckSections(fixture);
    expect(commanderRows).toHaveLength(1);
    expect(companionRows).toHaveLength(0); // MTGJSON precons have no companion zone
    expect(deckRows).toHaveLength(2);

    const commander = commanderRows[0];
    expect(commander.section).toBe('commander');
    expect(commander.scryfallId).toBe('cmdr-id');
    expect(commander.finish).toBe('foil');
    expect(commander.setCode).toBe('SLD');
    expect(commander.collectorNumber).toBe('1508');
    expect(commander.sourceFormat).toBe('mtgjson');

    // displayCommander / tokens must NOT leak into the deck.
    const deckIds = [...commanderRows, ...deckRows].map((r) => r.scryfallId);
    expect(deckIds).not.toContain('disp-1');
    expect(deckIds).not.toContain('tok-1');
  });

  it('preserves multi-copy counts and foil per row', () => {
    const { deckRows } = productToDeckSections(fixture);
    const plains = deckRows.find((r) => r.name === 'Plains');
    expect(plains?.quantity).toBe(10);
    expect(plains?.finish).toBe('foil');
    const sol = deckRows.find((r) => r.name === 'Sol Ring');
    expect(sol?.quantity).toBe(1);
    expect(sol?.finish).toBe('nonfoil');
  });
});

describe('productToExtraRows', () => {
  it('collects every extra physical zone (display commanders + tokens) and tags the zone', () => {
    const extras = productToExtraRows(fixture);
    // 3 display commanders + 1 token = 4 extra physical cards.
    expect(extras).toHaveLength(4);
    expect(extras.filter((r) => r.sourceCategory === 'displayCommander')).toHaveLength(3);
    expect(extras.filter((r) => r.sourceCategory === 'tokens')).toHaveLength(1);
    expect(extras.every((r) => r.sourceFormat === 'mtgjson')).toBe(true);
    // The etched display commander carries its own distinct printing/id.
    expect(extras.map((r) => r.scryfallId)).toContain('disp-1');
  });

  it('returns an empty array when there are no extra zones', () => {
    expect(
      productToExtraRows({ name: 'x', code: 'X', type: 'Commander Deck', mainBoard: [] })
    ).toEqual([]);
  });

  it('discovers an unknown card-bearing zone but skips string-metadata arrays', () => {
    // Simulate a future MTGJSON zone ("bonusCards") plus the real metadata
    // arrays MTGJSON ships (string UUIDs/set codes) that must NOT be treated as cards.
    const withUnknownZone = {
      name: 'x',
      code: 'X',
      type: 'Commander Deck',
      commander: [],
      mainBoard: [],
      bonusCards: [
        {
          count: 1,
          name: 'Moggcatcher',
          setCode: 'SLD',
          number: '999',
          isFoil: true,
          identifiers: { scryfallId: 'mogg-id' },
        },
      ],
      sealedProductUuids: ['uuid-1', 'uuid-2'],
      sourceSetCodes: ['SLD'],
    } as unknown as MtgjsonDeckFile;

    const extras = productToExtraRows(withUnknownZone);
    expect(extras).toHaveLength(1);
    expect(extras[0].name).toBe('Moggcatcher');
    expect(extras[0].sourceCategory).toBe('bonusCards');
    expect(extras[0].scryfallId).toBe('mogg-id');
  });
});

describe('productToPhysicalRows', () => {
  it('includes every zone — deck cards AND extras — finish-accurate', () => {
    const rows = productToPhysicalRows(fixture);
    // 1 commander + 2 mainBoard entries + 3 display + 1 token = 7 rows.
    expect(rows).toHaveLength(7);
    const zones = rows.map((r) => r.sourceCategory);
    expect(zones).toContain('commander');
    expect(zones).toContain('mainBoard');
    expect(zones).toContain('displayCommander');
    expect(zones).toContain('tokens');
    // Foil treatment preserved per copy (foil Plains, nonfoil display commander).
    const plains = rows.find((r) => r.name === 'Plains');
    expect(plains?.finish).toBe('foil');
    expect(plains?.quantity).toBe(10);
  });
});

describe('countPhysicalCards', () => {
  it('counts every zone including extras and multi-copy lands', () => {
    // 1 commander + (1 Sol Ring + 10 Plains) + 3 display + 1 token = 16
    expect(countPhysicalCards(fixture)).toBe(16);
  });
});
