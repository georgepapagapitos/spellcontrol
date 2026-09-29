import { describe, it, expect } from 'vitest';
import { SAMPLE_BINDERS, SAMPLE_CARDS, SAMPLE_IMPORT_LABEL, sampleCardsAsCsv } from './samples';
import { materializeBinders } from './materialize';
import type { BinderDef, EnrichedCard } from '@/types/index';

describe('samples', () => {
  it('exposes at least one sample binder template', () => {
    expect(SAMPLE_BINDERS.length).toBeGreaterThan(0);
    for (const t of SAMPLE_BINDERS) {
      expect(t.templateId.length).toBeGreaterThan(0);
      expect(t.input.isSample).toBe(true);
      expect(t.input.filterGroups.length).toBeGreaterThan(0);
    }
  });

  it('exposes a non-empty starter pack', () => {
    expect(SAMPLE_CARDS.length).toBeGreaterThan(0);
    expect(SAMPLE_IMPORT_LABEL).toMatch(/sample/i);
  });

  // E473: physical-first defaults. Every sample sorts on a field (color or
  // mana value) that splits a dozen-card demo pack into several small groups;
  // without packing, each group burns its own page ("8 cards over 5 pages" —
  // project_binder_program.md). Real accounts that loaded samples before this
  // changed keep their old (unpacked) binder rows — this only covers what a
  // FRESH "Load samples" click creates from here on.
  it('packs sections so a small sample pack does not burn a page per group', () => {
    for (const t of SAMPLE_BINDERS) {
      expect(t.input.packSections, t.templateId).toBe(true);
    }
  });

  it('a mana-value-sorted sample pack lands on one page packed, several unpacked', () => {
    const rockyard: EnrichedCard[] = [0, 1, 1, 2, 2, 3, 4, 5].map(
      (cmc, i) =>
        ({
          copyId: `c${i}`,
          scryfallId: `sf${i}`,
          oracleId: `o${i}`,
          name: `Rock ${i}`,
          typeLine: 'Artifact',
          colorIdentity: [],
          colors: [],
          rarity: 'common',
          purchasePrice: 1,
          setCode: 'tst',
          setName: 'Test',
          collectorNumber: String(i),
          quantity: 1,
          cmc,
          tags: ['mana-rock'],
        }) as unknown as EnrichedCard
    );
    const manaRocks = SAMPLE_BINDERS.find((t) => t.templateId === 'mana-rocks')!;
    const def = (packSections: boolean): BinderDef => ({
      id: 'b1',
      name: manaRocks.input.name,
      position: 0,
      filterGroups: manaRocks.input.filterGroups,
      sorts: manaRocks.input.sorts,
      pocketSize: manaRocks.input.pocketSize,
      doubleSided: manaRocks.input.doubleSided,
      fixedCapacity: null,
      color: manaRocks.input.color,
      packSections,
      createdAt: 0,
      updatedAt: 0,
    });

    const packed = materializeBinders(rockyard, [def(true)], { search: '' });
    const unpacked = materializeBinders(rockyard, [def(false)], { search: '' });

    expect(packed.binders[0].totalCards).toBe(8);
    expect(unpacked.binders[0].totalCards).toBe(8);
    expect(packed.binders[0].totalPages).toBe(1);
    expect(unpacked.binders[0].totalPages).toBeGreaterThan(1);
  });
});

describe('sampleCardsAsCsv', () => {
  it('starts with the name,finish header', () => {
    const csv = sampleCardsAsCsv();
    expect(csv.split('\n')[0]).toBe('name,finish');
  });

  it('emits one row per sample card', () => {
    const csv = sampleCardsAsCsv();
    expect(csv.split('\n').length).toBe(SAMPLE_CARDS.length + 1);
  });

  it('quotes names containing commas and escapes inner quotes', () => {
    const csv = sampleCardsAsCsv();
    expect(csv).toContain('"Atraxa, Praetors\' Voice",foil');
  });

  it('renders the finish value as foil/nonfoil text', () => {
    const csv = sampleCardsAsCsv();
    expect(csv).toContain('"Sol Ring",foil');
    expect(csv).toContain('"Wurmcoil Engine",nonfoil');
  });
});
