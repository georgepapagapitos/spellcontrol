import { describe, it, expect } from 'vitest';
import { parseCsvAuto, detectCsvFormat } from './csv';

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

  it('treats blank finish cells as undefined', () => {
    const csv = 'Name,Foil,Price\nSol Ring,,';
    const r = parseCsvAuto(csv, 'generic-csv').rows[0];
    expect(r.purchasePrice).toBeUndefined();
    expect(r.finish).toBeUndefined();
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
});
