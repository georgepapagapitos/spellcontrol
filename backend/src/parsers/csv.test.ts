import { describe, it, expect } from 'vitest';
import { parseCsvAuto, detectCsvFormat, parseCondition, parseLanguage } from './csv';

describe('detectCsvFormat', () => {
  it('detects manabox by Scryfall ID + Binder Name', () => {
    expect(detectCsvFormat(['Scryfall ID', 'Binder Name'])).toBe('manabox');
  });
  it('detects moxfield by Count + Tradelist Count + Edition', () => {
    expect(detectCsvFormat(['Count', 'Tradelist Count', 'Edition'])).toBe('moxfield');
  });
  it('detects archidekt-style headers', () => {
    expect(detectCsvFormat(['Name', 'Edition', 'Quantity'])).toBe('archidekt');
  });
  it('falls back to generic-csv when only a name column is present', () => {
    expect(detectCsvFormat(['name', 'foil'])).toBe('generic-csv');
  });
  it('returns null when no name column is present', () => {
    expect(detectCsvFormat(['foo', 'bar'])).toBeNull();
  });
});

describe('parseCsvAuto', () => {
  it('returns no rows when only the header is present', () => {
    expect(parseCsvAuto('name,foil', 'generic-csv').rows).toEqual([]);
  });

  it('returns no rows when there is no name column', () => {
    const out = parseCsvAuto('foo,bar\n1,2', 'generic-csv');
    expect(out.rows).toEqual([]);
    expect(out.unparsedLines).toEqual(['1,2']);
  });

  it('parses quoted commas and escaped quotes', () => {
    const csv = 'name,foil\n"Atraxa, Praetors\'\' Voice",true';
    const out = parseCsvAuto(csv, 'generic-csv');
    expect(out.rows[0].name).toBe("Atraxa, Praetors'' Voice");
    expect(out.rows[0].finish).toBe('foil');
  });

  it('strips a UTF-8 BOM from the start of the file', () => {
    const csv = '﻿name,foil\nSol Ring,false';
    expect(parseCsvAuto(csv, 'generic-csv').rows[0].name).toBe('Sol Ring');
  });

  it('skips blank lines and rows with no name', () => {
    const csv = 'name,foil\nSol Ring,false\n\n,true';
    const out = parseCsvAuto(csv, 'generic-csv');
    expect(out.rows).toHaveLength(1);
    expect(out.unparsedLines).toContain(',true');
  });

  it('drops a Quantity:0 (unowned/wishlist) row instead of importing 1 copy (F28)', () => {
    const csv = 'name,quantity\nSol Ring,0\nArcane Signet,2';
    const out = parseCsvAuto(csv, 'generic-csv');
    expect(out.rows.map((r) => r.name)).toEqual(['Arcane Signet']);
    expect(out.rows[0].quantity).toBe(2);
  });

  it('uses tab when the header contains one', () => {
    const csv = 'name\tfoil\nSol Ring\ttrue';
    expect(parseCsvAuto(csv, 'generic-csv').rows[0].name).toBe('Sol Ring');
  });

  it('uses semicolon when the header has no comma', () => {
    const csv = 'name;foil\nSol Ring;true';
    expect(parseCsvAuto(csv, 'generic-csv').rows[0].name).toBe('Sol Ring');
  });

  it('parses quantity, price, finish, set, and rarity', () => {
    const csv = 'Name,Set Code,Quantity,Foil,Rarity,Price\nSol Ring,CMR,3,foil,UNCOMMON,$1.50';
    const r = parseCsvAuto(csv, 'generic-csv').rows[0];
    expect(r.quantity).toBe(3);
    expect(r.finish).toBe('foil');
    expect(r.rarity).toBe('uncommon');
    expect(r.purchasePrice).toBe(1.5);
    expect(r.setCode).toBe('CMR');
  });

  it('treats invalid prices and quantities as missing/defaults', () => {
    const csv = 'Name,Quantity,Price\nSol Ring,abc,-5';
    const r = parseCsvAuto(csv, 'generic-csv').rows[0];
    expect(r.quantity).toBe(1);
    expect(r.purchasePrice).toBeUndefined();
  });

  it('treats out-of-range prices as missing', () => {
    const csv = 'Name,Price\nSol Ring,99999';
    expect(parseCsvAuto(csv, 'generic-csv').rows[0].purchasePrice).toBeUndefined();
  });

  it('accepts finish aliases (yes/no/true/false/normal/foil/etched/...)', () => {
    const csv = 'Name,Foil\nA,yes\nB,no\nC,foil\nD,nonfoil\nE,non-foil\nF,maybe\nG,etched';
    const out = parseCsvAuto(csv, 'generic-csv').rows;
    expect(out[0].finish).toBe('foil');
    expect(out[1].finish).toBe('nonfoil');
    expect(out[2].finish).toBe('foil');
    expect(out[3].finish).toBe('nonfoil');
    expect(out[4].finish).toBe('nonfoil');
    expect(out[5].finish).toBeUndefined();
    expect(out[6].finish).toBe('etched');
  });

  it('treats blank finish cells as nonfoil (Moxfield convention)', () => {
    const csv = 'Name,Foil,Price\nSol Ring,,';
    const r = parseCsvAuto(csv, 'generic-csv').rows[0];
    expect(r.purchasePrice).toBeUndefined();
    expect(r.finish).toBe('nonfoil');
  });

  it('parses "Printing" column as finish', () => {
    const csv = 'Name,Printing\nA,Foil\nB,Normal\nC,Etched';
    const out = parseCsvAuto(csv, 'generic-csv').rows;
    expect(out[0].finish).toBe('foil');
    expect(out[1].finish).toBe('nonfoil');
    expect(out[2].finish).toBe('etched');
  });

  it('returns empty rows for empty input', () => {
    expect(parseCsvAuto('', 'generic-csv').rows).toEqual([]);
  });

  it('captures condition, language, altered, proxy from Moxfield-style CSV', () => {
    const csv =
      'Count,Name,Edition,Condition,Language,Foil,Alter,Proxy\n' +
      '1,Sol Ring,CMR,Near Mint,English,foil,False,False\n' +
      '1,Lightning Bolt,M11,Lightly Played,Japanese,,True,True';
    const out = parseCsvAuto(csv, 'moxfield').rows;
    expect(out[0]).toMatchObject({
      condition: 'nm',
      language: 'en',
      altered: false,
      proxy: false,
      finish: 'foil',
    });
    expect(out[1]).toMatchObject({
      condition: 'lp',
      language: 'ja',
      altered: true,
      proxy: true,
    });
  });

  it('captures condition, language, finish from Archidekt-style CSV', () => {
    const csv =
      'Quantity,Name,Finish,Condition,Language,Edition Code\n' + '1,Sol Ring,Etched,NM,EN,CMR';
    const r = parseCsvAuto(csv, 'archidekt').rows[0];
    expect(r.finish).toBe('etched');
    expect(r.condition).toBe('nm');
    expect(r.language).toBe('en');
  });

  // E127: realistic multi-row exports with the nasty cases bundled together —
  // a split-card name, a foil printing, condition/language columns, a genuine
  // qty-0 wishlist row, and a malformed row. Every input row must be
  // accounted for as either imported, skipped-unowned, or malformed — no
  // silent drops.
  it('accounts for every row in a realistic multi-row Moxfield export', () => {
    const header =
      'Count,Tradelist Count,Name,Edition,Condition,Language,Foil,Tags,Last Modified,' +
      'Collector Number,Alter,Photo,Purchase Price';
    const rows = [
      '1,0,Sol Ring,Commander Masters,Near Mint,English,,,2024-01-01,472,False,,1.50',
      '1,0,Fire // Ice,Apocalypse,Lightly Played,English,foil,,2024-01-01,90,False,,3.00',
      // Tradelist-only entry — not owned, must be skipped rather than imported as 1 copy.
      '0,3,Mox Diamond,Stronghold,Near Mint,English,,,2024-01-01,12,False,,45.00',
      // Malformed: no name.
      ',0,,Kaladesh,Near Mint,English,,,2024-01-01,,False,,',
    ];
    const out = parseCsvAuto(`${header}\n${rows.join('\n')}`, 'moxfield');

    expect(out.rows.map((r) => r.name)).toEqual(['Sol Ring', 'Fire // Ice']);
    expect(out.rows[1]).toMatchObject({
      finish: 'foil',
      condition: 'lp',
      collectorNumber: '90',
    });
    expect(out.skippedUnownedRows).toBe(1);
    expect(out.unparsedLines).toHaveLength(1);
    // Zero silent drops: every data row is imported, skipped-unowned, or malformed.
    expect(out.rows.length + out.skippedUnownedRows + out.unparsedLines.length).toBe(rows.length);
  });

  it('accounts for every row in a realistic multi-row Deckbox export', () => {
    const header =
      'Count,Tradelist Count,Name,Edition,Card Number,Condition,Language,Foil,Signed,' +
      'Altered Art,Misprint,My Price,Tags';
    const rows = [
      '2,0,Sol Ring,Commander Masters,472,Near Mint,English,,False,False,False,1.50,',
      '1,0,Fire // Ice,Apocalypse,90,Lightly Played,English,foil,False,False,False,3.00,',
      // Tradelist-only entry — not owned.
      '0,4,Mox Diamond,Stronghold,12,Near Mint,English,,False,False,False,45.00,',
      // Malformed: no name.
      ',0,,Kaladesh,,Near Mint,English,,False,False,False,,',
    ];
    const out = parseCsvAuto(`${header}\n${rows.join('\n')}`, 'deckbox');

    expect(out.rows.map((r) => r.name)).toEqual(['Sol Ring', 'Fire // Ice']);
    expect(out.rows[1]).toMatchObject({ finish: 'foil', condition: 'lp' });
    expect(out.skippedUnownedRows).toBe(1);
    expect(out.unparsedLines).toHaveLength(1);
    expect(out.rows.length + out.skippedUnownedRows + out.unparsedLines.length).toBe(rows.length);
  });
});

describe('parseCondition', () => {
  it('normalizes common condition values', () => {
    expect(parseCondition('NM')).toBe('nm');
    expect(parseCondition('Near Mint')).toBe('nm');
    expect(parseCondition('near_mint')).toBe('nm');
    expect(parseCondition('LP')).toBe('lp');
    expect(parseCondition('Lightly Played')).toBe('lp');
    expect(parseCondition('lightly_played')).toBe('lp');
    expect(parseCondition('MP')).toBe('mp');
    expect(parseCondition('Moderately Played')).toBe('mp');
    expect(parseCondition('HP')).toBe('hp');
    expect(parseCondition('Heavily Played')).toBe('hp');
    expect(parseCondition('Damaged')).toBe('damaged');
    expect(parseCondition('DMG')).toBe('damaged');
    expect(parseCondition('Poor')).toBe('damaged');
  });
  it('returns undefined for unknown / empty values', () => {
    expect(parseCondition('')).toBeUndefined();
    expect(parseCondition(undefined)).toBeUndefined();
    expect(parseCondition('zonk')).toBeUndefined();
  });
});

describe('parseLanguage', () => {
  it('normalizes full language names to Scryfall codes', () => {
    expect(parseLanguage('English')).toBe('en');
    expect(parseLanguage('Japanese')).toBe('ja');
    expect(parseLanguage('German')).toBe('de');
    expect(parseLanguage('Simplified Chinese')).toBe('zhs');
  });
  it('passes through short codes lowercased', () => {
    expect(parseLanguage('EN')).toBe('en');
    expect(parseLanguage('zhs')).toBe('zhs');
    expect(parseLanguage('ja')).toBe('ja');
  });
  it('returns undefined for empty values', () => {
    expect(parseLanguage('')).toBeUndefined();
    expect(parseLanguage(undefined)).toBeUndefined();
  });
});
