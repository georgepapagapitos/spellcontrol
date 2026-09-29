/**
 * `planVolumes` invariants — the volumes counterpart to the sort stress audit
 * and the filter algebra audit (`project_binder_program`). Two layers:
 *
 * 1. Hand-built `BinderSection`-shaped fixtures, for the exact edge cases the
 *    contract names (no capacity, empty binder, exactly-full, a section
 *    bigger than a whole volume).
 * 2. A matrix run through the REAL `materializeBinders` (pocket size ×
 *    `packSections` mode × capacity), checking the properties that must hold
 *    for ANY binder rather than one hand-picked case: partition, capacity,
 *    card conservation, "sections aren't split when they fit", determinism,
 *    and label correctness.
 */
import { describe, it, expect } from 'vitest';
import { materializeBinders } from './materialize.js';
import { planVolumes, smallestFittingCapacity, standardBinderSizes } from './volumes.js';
import type { BinderDef, BinderSection, EnrichedCard, PocketSize } from './types.js';

function makeCard(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: crypto.randomUUID(),
    name: 'Test Card',
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: `id-${Math.random()}`,
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    ...overrides,
  };
}

function makeBinder(overrides: Partial<BinderDef> = {}): BinderDef {
  return {
    id: `binder-${Math.random()}`,
    name: 'Test Binder',
    position: 0,
    filterGroups: [{ filter: {} }],
    sorts: [{ field: 'name', dir: 'asc' }],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#fff',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/** One card per letter-bucket, `counts[i]` cards starting with letter A+i. */
function lettersCards(counts: number[]): EnrichedCard[] {
  const cards: EnrichedCard[] = [];
  counts.forEach((count, i) => {
    const letter = String.fromCharCode(65 + i);
    for (let j = 0; j < count; j++) {
      cards.push(makeCard({ name: `${letter}${j}`, copyId: `${letter}-${j}` }));
    }
  });
  return cards;
}

// ---------------------------------------------------------------------------
// Hand-built fixtures
// ---------------------------------------------------------------------------

/** Builds `BinderSection`-shaped fixtures with globally-numbered pages. */
function buildFixtureSections(
  spec: { label: string; pageCounts: number[] }[]
): Pick<BinderSection, 'label' | 'pages'>[] {
  let pageNum = 0;
  return spec.map(({ label, pageCounts }) => ({
    label,
    pages: pageCounts.map((n) => {
      pageNum += 1;
      return { pageNum, slots: Array.from({ length: n }, () => makeCard()) };
    }),
  }));
}

describe('planVolumes — fixtures', () => {
  it('returns null when the binder has no fixed capacity', () => {
    const sections = buildFixtureSections([{ label: 'A', pageCounts: [9, 9] }]);
    expect(planVolumes(sections, { capacityCards: null, pocketSize: 9 })).toBeNull();
  });

  it('returns an empty array for an empty binder', () => {
    expect(planVolumes([], { capacityCards: 360, pocketSize: 9 })).toEqual([]);
  });

  it('returns a single volume when everything fits exactly', () => {
    const sections = buildFixtureSections([{ label: 'A', pageCounts: [9, 9] }]);
    const volumes = planVolumes(sections, { capacityCards: 18, pocketSize: 9 });
    expect(volumes).toEqual([
      { index: 1, pageStart: 1, pageEnd: 2, cardCount: 18, firstLabel: 'A', lastLabel: 'A' },
    ]);
  });

  it('returns a single volume when the binder is smaller than capacity', () => {
    const sections = buildFixtureSections([{ label: 'A', pageCounts: [9] }]);
    const volumes = planVolumes(sections, { capacityCards: 360, pocketSize: 9 });
    expect(volumes).toHaveLength(1);
    expect(volumes![0]).toMatchObject({ pageStart: 1, pageEnd: 1, cardCount: 9 });
  });

  it('cuts at a section boundary instead of splitting a section that would overflow', () => {
    // Capacity = 3 pages. Section A (2 pages) fits; section B (2 pages) does
    // NOT fit in the 1 page left over, so B starts a fresh volume instead of
    // spilling 1 page of itself into volume 1's remaining space.
    const sections = buildFixtureSections([
      { label: 'A', pageCounts: [9, 9] },
      { label: 'B', pageCounts: [9, 9] },
    ]);
    const volumes = planVolumes(sections, { capacityCards: 27, pocketSize: 9 });
    expect(volumes).toEqual([
      { index: 1, pageStart: 1, pageEnd: 2, cardCount: 18, firstLabel: 'A', lastLabel: 'A' },
      { index: 2, pageStart: 3, pageEnd: 4, cardCount: 18, firstLabel: 'B', lastLabel: 'B' },
    ]);
  });

  it('splits a section bigger than a whole volume at page boundaries, never mid-page', () => {
    // Capacity = 2 pages. One 5-page section must become 3 volumes: 2 + 2 + 1.
    const sections = buildFixtureSections([{ label: 'A', pageCounts: [9, 9, 9, 9, 9] }]);
    const volumes = planVolumes(sections, { capacityCards: 18, pocketSize: 9 });
    expect(volumes).toEqual([
      { index: 1, pageStart: 1, pageEnd: 2, cardCount: 18, firstLabel: 'A', lastLabel: 'A' },
      { index: 2, pageStart: 3, pageEnd: 4, cardCount: 18, firstLabel: 'A', lastLabel: 'A' },
      { index: 3, pageStart: 5, pageEnd: 5, cardCount: 9, firstLabel: 'A', lastLabel: 'A' },
    ]);
  });

  it('handles a partial final page correctly in card counts', () => {
    // Section has one full page (9) and one partial page (4 real cards, 5 nulls).
    const partialSection: Pick<BinderSection, 'label' | 'pages'> = {
      label: 'A',
      pages: [
        { pageNum: 1, slots: Array.from({ length: 9 }, () => makeCard()) },
        {
          pageNum: 2,
          slots: [...Array.from({ length: 4 }, () => makeCard()), null, null, null, null, null],
        },
      ],
    };
    const volumes = planVolumes([partialSection], { capacityCards: 360, pocketSize: 9 });
    expect(volumes).toEqual([
      { index: 1, pageStart: 1, pageEnd: 2, cardCount: 13, firstLabel: 'A', lastLabel: 'A' },
    ]);
  });

  it('clamps capacity to at least one page per volume so it never loops forever', () => {
    // capacityCards (5) < pocketSize (9) -> floor is 0, clamped to 1.
    const sections = buildFixtureSections([{ label: 'A', pageCounts: [9, 9, 9] }]);
    const volumes = planVolumes(sections, { capacityCards: 5, pocketSize: 9 });
    expect(volumes).toHaveLength(3);
    expect(volumes!.every((v) => v.pageEnd - v.pageStart + 1 === 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Real materialize() invariants
// ---------------------------------------------------------------------------

const POCKET_SIZES: PocketSize[] = [4, 9, 12];
const PACK_MODES: Array<boolean | 'continuous'> = [false, true, 'continuous'];
const CAPACITIES = [40, 90, 150, 1000];

describe('planVolumes — invariants over materializeBinders', () => {
  // Deliberately uneven letter-bucket sizes: some tiny (A), some bigger than
  // a whole volume at the smallest tested capacity (G = 60 cards).
  const counts = [1, 30, 7, 45, 2, 15, 60, 3, 22, 8];
  const cards = lettersCards(counts);

  for (const pocketSize of POCKET_SIZES) {
    for (const packSections of PACK_MODES) {
      for (const capacityCards of CAPACITIES) {
        it(`partitions, conserves cards, and respects section boundaries (pocket=${pocketSize}, pack=${packSections}, cap=${capacityCards})`, () => {
          const def = makeBinder({
            pocketSize,
            packSections,
            fixedCapacity: capacityCards,
            sorts: [{ field: 'name', dir: 'asc' }],
          });
          const { binders } = materializeBinders(cards, [def], { search: '' });
          const binder = binders[0];
          const volumes = planVolumes(binder.sections, {
            capacityCards,
            pocketSize: binder.effectivePocketSize,
          });
          expect(volumes).not.toBeNull();
          const vols = volumes!;

          if (binder.totalPages === 0) {
            expect(vols).toEqual([]);
            return;
          }

          // Partition: consecutive, no gap/overlap, covers page 1..totalPages exactly.
          expect(vols[0].pageStart).toBe(1);
          expect(vols[vols.length - 1].pageEnd).toBe(binder.totalPages);
          for (let i = 1; i < vols.length; i++) {
            expect(vols[i].pageStart).toBe(vols[i - 1].pageEnd + 1);
          }

          // No volume ever exceeds its page capacity.
          const capacityPages = Math.max(1, Math.floor(capacityCards / pocketSize));
          for (const v of vols) {
            expect(v.pageEnd - v.pageStart + 1).toBeLessThanOrEqual(capacityPages);
          }

          // Every card is accounted for exactly once.
          expect(vols.reduce((s, v) => s + v.cardCount, 0)).toBe(binder.totalCards);

          // A section that fits within one volume's worth of pages is never
          // split across a volume boundary.
          for (const section of binder.sections) {
            const pageCount = section.pages.length;
            if (pageCount === 0 || pageCount > capacityPages) continue;
            const start = section.pages[0].pageNum;
            const end = section.pages[section.pages.length - 1].pageNum;
            const containing = vols.find((v) => v.pageStart <= start && end <= v.pageEnd);
            expect(
              containing,
              `section "${section.label}" (pages ${start}-${end}) should sit inside one volume`
            ).toBeTruthy();
          }

          // Determinism.
          const again = planVolumes(binder.sections, {
            capacityCards,
            pocketSize: binder.effectivePocketSize,
          });
          expect(again).toEqual(vols);

          // Labels name the section actually covering the volume's edges.
          for (const v of vols) {
            const firstSection = binder.sections.find((s) =>
              s.pages.some((p) => p.pageNum === v.pageStart)
            );
            const lastSection = binder.sections.find((s) =>
              s.pages.some((p) => p.pageNum === v.pageEnd)
            );
            expect(v.firstLabel).toBe(firstSection?.label);
            expect(v.lastLabel).toBe(lastSection?.label);
          }
        });
      }
    }
  }

  it('splits a manual-order (single flat section) binder by page boundaries alone', () => {
    const manualCards = Array.from({ length: 50 }, (_, i) =>
      makeCard({ name: `Card ${i}`, copyId: `m${i}` })
    );
    const def = makeBinder({
      pocketSize: 9,
      fixedCapacity: 90,
      manualOrder: manualCards.map((c) => c.copyId),
    });
    const { binders } = materializeBinders(manualCards, [def], { search: '' });
    const binder = binders[0];
    // Manual order collapses to ALL_SECTION — one flat section, no headers.
    expect(binder.sections).toHaveLength(1);
    const volumes = planVolumes(binder.sections, { capacityCards: 90, pocketSize: 9 })!;
    // 50 cards / 9 per page = 6 pages; capacityPages = floor(90/9) = 10 -> fits in one volume.
    expect(volumes).toHaveLength(1);
    expect(volumes[0].cardCount).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// smallestFittingCapacity / standardBinderSizes
// ---------------------------------------------------------------------------

describe('standardBinderSizes / smallestFittingCapacity', () => {
  it('gives the marketed 360/480/640 sizes at 9 pockets', () => {
    expect(standardBinderSizes(9)).toEqual([360, 480, 640]);
  });

  it('has a reasoned (not formula-derived) catalogue for 4 and 12 pockets too', () => {
    expect(standardBinderSizes(4)).toEqual([160, 240, 320]);
    expect(standardBinderSizes(12)).toEqual([480, 720, 960]);
  });

  it('fits by PAGES, not raw card count', () => {
    // 9 pockets: 360 -> 40 pages, 480 -> 53 pages, 640 -> 71 pages.
    expect(smallestFittingCapacity(40, 9)).toBe(360); // exact fit
    expect(smallestFittingCapacity(41, 9)).toBe(480); // one page over -> next tier
    expect(smallestFittingCapacity(71, 9)).toBe(640);
  });

  it('a card count under a size can still fail to fit once pages are counted', () => {
    // A binder that starts a fresh page per section can need far more pages
    // than its card count alone would suggest: 45 pages needs 45*9 = 405
    // pockets, more than a 360 (40-page) binder holds even though a naive
    // "350 cards < 360" comparison would have said yes.
    expect(smallestFittingCapacity(45, 9)).not.toBe(360);
    expect(smallestFittingCapacity(45, 9)).toBe(480);
  });

  it('returns null when nothing in the catalogue fits', () => {
    expect(smallestFittingCapacity(72, 9)).toBeNull();
  });

  it('accepts a custom size catalogue', () => {
    expect(smallestFittingCapacity(15, 4, [40, 80])).toBe(80);
    expect(smallestFittingCapacity(10, 4, [40, 80])).toBe(40);
  });

  it('is order-independent over the size list', () => {
    expect(smallestFittingCapacity(10, 4, [80, 40, 120])).toBe(40);
  });
});
