import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ importDeckText: vi.fn() }));
import { cubeExportFileName, toCubeCobraCsv, toCubeCobraList, toDraftmancerCube } from './format';
import { stripDraftmancerStructure } from './paste-import';
import { Pick } from './generate';

const pick = (name: string): Pick => ({
  card: { name, oracleId: name, colors: [], cmc: 0, typeLine: '', role: null },
  bucket: 'colorless',
  reason: '',
});

describe('toCubeCobraList', () => {
  it('emits one alphabetized card name per line', () => {
    expect(toCubeCobraList([pick('Sol Ring'), pick('Ancestral Recall'), pick('Black Lotus')])).toBe(
      'Ancestral Recall\nBlack Lotus\nSol Ring'
    );
  });
});

const cardPick = (name: string, over: Partial<Pick['card']> = {}): Pick => ({
  ...pick(name),
  card: { ...pick(name).card, ...over },
});

describe('toDraftmancerCube', () => {
  it('writes the Settings JSON, a slot header, then alphabetized names', () => {
    const out = toDraftmancerCube([pick('Sol Ring'), pick('Ancestral Recall')], 'My "Power" Cube');
    expect(out).toBe(
      '[Settings]\n{\n  "name": "My \\"Power\\" Cube"\n}\n[Cube(15)]\nAncestral Recall\nSol Ring\n'
    );
  });

  it('round-trips through the paste-import cleaner back to the card names', () => {
    const out = toDraftmancerCube([pick('Sol Ring'), pick('Black Lotus')], 'Vintage');
    expect(stripDraftmancerStructure(out).trim()).toBe('Black Lotus\nSol Ring');
  });
});

describe('toCubeCobraCsv', () => {
  it('starts with CubeCobra export header columns', () => {
    const header = toCubeCobraCsv([]).split('\n')[0];
    expect(header).toBe(
      'name,CMC,Type,Color,Set,Collector Number,Rarity,Color Category,status,Finish,maybeboard,image URL,image Back URL,tags,Notes,MTGO ID'
    );
  });

  it('quotes cells with commas and fills Set / Collector Number from the owned copy', () => {
    const csv = toCubeCobraCsv(
      [
        cardPick('Wrenn, the Plant', {
          cmc: 3,
          colors: ['G', 'U'],
          typeLine: 'Legendary Creature, Elf',
        }),
        cardPick('Sol Ring'),
      ],
      (n) => (n === 'Sol Ring' ? { setCode: 'C21', collectorNumber: '263' } : null)
    );
    const lines = csv.trim().split('\n');
    expect(lines[1].startsWith('Sol Ring,0,,,c21,263,')).toBe(true);
    expect(lines[2].startsWith('"Wrenn, the Plant",3,"Legendary Creature, Elf",GU,,,')).toBe(true);
  });
});

describe('cubeExportFileName', () => {
  it('slugs the cube name and falls back when it has no letters', () => {
    expect(cubeExportFileName("Geo's Vintage Cube!", 'draftmancer', 'txt')).toBe(
      'geo-s-vintage-cube-draftmancer.txt'
    );
    expect(cubeExportFileName('???', 'cubecobra', 'csv')).toBe('cube-cubecobra.csv');
  });
});
