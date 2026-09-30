import { describe, expect, it } from 'vitest';
import { formatPagesSummary, leaveRoomOf, leaveRoomPockets } from './binder-pages-summary';

describe('formatPagesSummary', () => {
  it('leads with capacity in plain words, and halves pages into sheets when double-sided', () => {
    // 12-pocket, double-sided, capacity 480: 40 pages, 20 sheets (front+back share a sheet).
    expect(
      formatPagesSummary({
        pocketSize: 12,
        doubleSided: true,
        fixedCapacity: 480,
        packSections: false,
      })
    ).toBe('Holds 480 cards (20 sheets) · 12-pocket · both sides · New page per section');
  });

  it('one sheet per page when single-sided', () => {
    // 9-pocket, single-sided, capacity 360: 40 pages, 40 sheets (one page = one sheet).
    expect(
      formatPagesSummary({
        pocketSize: 9,
        doubleSided: false,
        fixedCapacity: 360,
        packSections: false,
      })
    ).toBe('Holds 360 cards (40 sheets) · 9-pocket · one side · New page per section');
  });

  it('reads "No size limit" instead of a bare "no limit"', () => {
    const summary = formatPagesSummary({
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: null,
      packSections: false,
    });
    expect(summary).toContain('No size limit');
    expect(summary).not.toMatch(/^no limit/i);
  });

  it('names every page-fill mode', () => {
    const base = {
      pocketSize: 9 as const,
      doubleSided: false,
      fixedCapacity: null,
    };
    expect(formatPagesSummary({ ...base, packSections: false })).toContain('New page per section');
    expect(formatPagesSummary({ ...base, packSections: true })).toContain('Keep sections whole');
    expect(formatPagesSummary({ ...base, packSections: 'continuous' })).toContain(
      'Fill every pocket'
    );
  });

  it('singular "sheet" for a one-sheet capacity', () => {
    const summary = formatPagesSummary({
      pocketSize: 12,
      doubleSided: false,
      fixedCapacity: 12,
      packSections: false,
    });
    expect(summary).toContain('(1 sheet)');
    expect(summary).not.toContain('1 sheets');
  });

  it('states the over-capacity fact up front when the draft needs several volumes', () => {
    const volumes = [
      {
        index: 1,
        pageStart: 1,
        pageEnd: 40,
        cardCount: 360,
        firstLabel: 'White',
        lastLabel: 'Blue',
      },
      {
        index: 2,
        pageStart: 41,
        pageEnd: 80,
        cardCount: 360,
        firstLabel: 'Blue',
        lastLabel: 'Black',
      },
      {
        index: 3,
        pageStart: 81,
        pageEnd: 120,
        cardCount: 360,
        firstLabel: 'Black',
        lastLabel: 'Red',
      },
      {
        index: 4,
        pageStart: 121,
        pageEnd: 138,
        cardCount: 25,
        firstLabel: 'Red',
        lastLabel: 'Green',
      },
    ];
    const summary = formatPagesSummary({
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: 360,
      packSections: false,
      volumes,
    });
    expect(summary).toBe(
      'Holds 360 cards (40 sheets) · 1,105 cards need 4 binders of 360 · 9-pocket · one side · New page per section'
    );
  });

  it('says nothing extra when the draft fits in a single volume', () => {
    const single = [
      {
        index: 1,
        pageStart: 1,
        pageEnd: 10,
        cardCount: 90,
        firstLabel: 'White',
        lastLabel: 'Green',
      },
    ];
    const summary = formatPagesSummary({
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: 360,
      packSections: false,
      volumes: single,
    });
    expect(summary).not.toContain('need');
  });

  it('says nothing extra with no fixed capacity, even if volumes were (incorrectly) passed', () => {
    const summary = formatPagesSummary({
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: null,
      packSections: false,
      volumes: null,
    });
    expect(summary).not.toContain('need');
  });

  it('names room left after each section, in the words the control uses', () => {
    const base = {
      pocketSize: 9 as const,
      doubleSided: false,
      fixedCapacity: null,
      packSections: false as const,
    };
    expect(formatPagesSummary({ ...base, sparePockets: 9 })).toContain(
      'a free page after each section'
    );
    expect(formatPagesSummary({ ...base, sparePockets: 5 })).toContain(
      'half a page free after each section'
    );
    expect(formatPagesSummary({ ...base, sparePockets: 3 })).toContain(
      '3 free pockets after each section'
    );
    expect(formatPagesSummary({ ...base, sparePockets: 0 })).not.toContain('free');
  });

  it('names a page break deeper than the section headers', () => {
    const summary = formatPagesSummary({
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: null,
      packSections: false,
      breakField: 'Mana value',
    });
    expect(summary).toBe(
      'No size limit · 9-pocket · one side · New page per section · new page per mana value too'
    );
  });
});

describe('leave room', () => {
  it('reserves half a page rounded up, or a whole page, at every pocket size', () => {
    expect([4, 9, 12].map((p) => leaveRoomPockets('half', p as 4 | 9 | 12))).toEqual([2, 5, 6]);
    expect([4, 9, 12].map((p) => leaveRoomPockets('full', p as 4 | 9 | 12))).toEqual([4, 9, 12]);
    expect(leaveRoomPockets('none', 9)).toBe(0);
  });

  it('reads a stored pocket count back as the same choice', () => {
    for (const p of [4, 9, 12] as const) {
      for (const room of ['none', 'half', 'full'] as const) {
        expect(leaveRoomOf(leaveRoomPockets(room, p), p)).toBe(room);
      }
    }
    expect(leaveRoomOf(undefined, 9)).toBe('none');
  });
});
