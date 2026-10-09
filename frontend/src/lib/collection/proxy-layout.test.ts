// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CARD_CORNER_PATH,
  PAPERS,
  SCALES,
  decklistSections,
  defaultPaper,
  fullPageScale,
  readSettings,
  sheetLayout,
  writeSettings,
  type LayoutSettings,
  type PaperId,
} from './proxy-layout';

const base: LayoutSettings = { paper: 'letter', gap: 0, scale: 100, cropMarks: true, bleed: false };

// Chrome fits no more than about 266.3 mm of height on Letter inside 5 mm
// margins (measured with printToPDF: 266 mm fit, 266.5 mm did not), so the
// first proxy sheet, a 267 mm page box, ended every Letter print on a blank
// page. Every layout must stay under what its paper fits.
const LETTER_FIT_MM = 266;
const fitsHeight = (paper: PaperId) => PAPERS[paper].height - 279.4 + LETTER_FIT_MM;

describe('sheetLayout', () => {
  it('prints nine real-size cards to a Letter or A4 page, as the sheet always has', () => {
    for (const paper of ['letter', 'a4'] as const) {
      const layout = sheetLayout({ ...base, paper });
      expect([layout.cols, layout.rows]).toEqual([3, 3]);
      expect(layout.card).toEqual({ width: 63, height: 88 });
      expect(layout.width).toBe(195);
      expect(layout.height).toBe(265.5);
    }
  });

  it('never builds a page taller or wider than its paper fits', () => {
    for (const paper of Object.keys(PAPERS) as PaperId[]) {
      for (const scale of SCALES) {
        for (const gap of [0, 0.2, 3]) {
          for (const bleed of [false, true]) {
            const layout = sheetLayout({ paper, gap, scale, bleed, cropMarks: true });
            expect(layout.height).toBeLessThanOrEqual(fitsHeight(paper));
            expect(layout.width).toBeLessThanOrEqual(PAPERS[paper].width - 10);
          }
        }
      }
    }
  });

  it('keeps a 0.2 mm gap at nine a page on Letter despite float noise', () => {
    expect(sheetLayout({ ...base, gap: 0.2 }).perPage).toBe(9);
  });

  it('puts each cut line once, at the card edges', () => {
    const adjacent = sheetLayout(base);
    expect(adjacent.cutsX).toEqual([3, 66, 129, 192]);
    expect(adjacent.cutsY).toEqual([0.75, 88.75, 176.75, 264.75]);
    const gapped = sheetLayout({ ...base, gap: 3 });
    expect(gapped.cutsX).toEqual([3, 66, 69, 132, 135, 198]);
  });

  it('fits more cards on bigger paper', () => {
    expect(sheetLayout({ ...base, paper: 'a3' }).perPage).toBe(16);
    expect(sheetLayout({ ...base, paper: 'tabloid' }).perPage).toBe(16);
    expect(sheetLayout({ ...base, paper: 'legal' }).perPage).toBe(9);
  });
});

describe('fullPageScale', () => {
  it('names the largest scale that wins the lost row back', () => {
    expect(fullPageScale({ ...base, bleed: true })).toBe(97);
    expect(sheetLayout({ ...base, bleed: true, scale: 97 }).perPage).toBe(9);
  });

  it('says nothing when the page is full', () => {
    expect(fullPageScale(base)).toBeUndefined();
    expect(fullPageScale({ ...base, scale: 95 })).toBeUndefined();
  });
});

describe('print settings', () => {
  beforeEach(() => localStorage.clear());

  it('starts on the paper the locale uses', () => {
    expect(defaultPaper('en-US')).toBe('letter');
    expect(defaultPaper('en-GB')).toBe('a4');
    expect(defaultPaper('de')).toBe('a4');
    expect(defaultPaper(undefined)).toBe('letter');
  });

  it('round-trips, and drops a saved value the page no longer offers', () => {
    writeSettings({ ...readSettings('en-US'), paper: 'a3', bleed: true });
    expect(readSettings('en-US')).toMatchObject({ paper: 'a3', bleed: true, scale: 100 });
    localStorage.setItem('sc-proxy-print-settings', '{"paper":"b5","scale":250,"gap":1}');
    expect(readSettings('en-US')).toMatchObject({ paper: 'letter', scale: 100, gap: 0 });
    localStorage.setItem('sc-proxy-print-settings', 'not json');
    expect(readSettings('en-US').paper).toBe('letter');
  });
});

describe('CARD_CORNER_PATH', () => {
  it('is the card box with its rounded outline cut out', () => {
    expect(CARD_CORNER_PATH.startsWith('M0 0H63V88H0Z')).toBe(true);
    expect(CARD_CORNER_PATH.match(/A2\.5 2\.5/g)).toHaveLength(4);
  });
});

describe('decklistSections', () => {
  const dc = (name: string) => ({ card: { name } }) as never;
  it('counts the deck by name, and adds the sideboard only when asked', () => {
    const deck = {
      commander: { name: 'Krenko, Mob Boss' },
      partnerCommander: null,
      cards: [dc('Opt'), dc('Sol Ring'), dc('Opt')],
      sideboard: [dc('Pyroblast')],
    } as never;
    expect(decklistSections(deck, false)).toEqual([
      { title: 'Commander', lines: [{ qty: 1, name: 'Krenko, Mob Boss' }] },
      {
        title: 'Deck',
        lines: [
          { qty: 2, name: 'Opt' },
          { qty: 1, name: 'Sol Ring' },
        ],
      },
    ]);
    expect(decklistSections(deck, true).map((s) => s.title)).toEqual([
      'Commander',
      'Deck',
      'Sideboard',
    ]);
  });
});
