import type { Deck } from '@/store/decks';
import { CARD_MM } from './proxy-sheet';

/**
 * The proxy sheet's print settings and the page geometry they produce. Every
 * length is in millimetres; the page renders the same numbers on screen (as a
 * scaled preview) and on paper (at 1 mm per unit), so the preview is the print.
 */

export type PaperId = 'letter' | 'legal' | 'tabloid' | 'a4' | 'a3';

export const PAPERS: Record<PaperId, { label: string; width: number; height: number }> = {
  letter: { label: 'Letter (8.5 × 11 in)', width: 215.9, height: 279.4 },
  legal: { label: 'Legal (8.5 × 14 in)', width: 215.9, height: 355.6 },
  tabloid: { label: 'Tabloid (11 × 17 in)', width: 279.4, height: 431.8 },
  a4: { label: 'A4 (21 × 29.7 cm)', width: 210, height: 297 },
  a3: { label: 'A3 (29.7 × 42 cm)', width: 297, height: 420 },
};

export const GAPS_MM = [0, 0.2, 3] as const;
export const SCALES = Array.from({ length: 21 }, (_, i) => 110 - i);

/** The printer margin on every side, set by the page's `@page` rule. */
export const PAGE_MARGIN_MM = 5;
/**
 * Chrome fits less than the paper minus its margins: about 266.3 mm of height
 * on Letter, not 269.4 (measured with printToPDF: 266 mm fit, 266.5 mm spilled
 * a blank page). The slack keeps every layout under what actually fits.
 */
const HEIGHT_SLACK_MM = 3.5;
const WIDTH_SLACK_MM = 1;
/** How far bleed extends past each cut, in black. */
export const BLEED_MM = 1;
/** Room for the crop marks: beside the grid and above and below it. */
const MARK_X_MM = 3;
const MARK_Y_MM = 0.75;
/** A Scryfall image's corner radius on a 63 mm card. */
export const CORNER_MM = 2.5;

const R = CORNER_MM;
const { width: W, height: H } = CARD_MM;
/**
 * Black corners, in a 63 × 88 viewBox: the card's box minus its rounded
 * outline (even-odd), so only the four corners fill. SVG, not a background:
 * browsers leave backgrounds out of a print by default.
 */
export const CARD_CORNER_PATH =
  `M0 0H${W}V${H}H0Z` +
  `M${R} 0H${W - R}A${R} ${R} 0 0 1 ${W} ${R}V${H - R}A${R} ${R} 0 0 1 ${W - R} ${H}` +
  `H${R}A${R} ${R} 0 0 1 0 ${H - R}V${R}A${R} ${R} 0 0 1 ${R} 0Z`;

export interface PrintSettings {
  paper: PaperId;
  gap: number;
  /** Percent: 100 prints at real size. */
  scale: number;
  skipBasics: boolean;
  cropMarks: boolean;
  blackCorners: boolean;
  bleed: boolean;
  watermark: boolean;
  decklist: boolean;
}

/** Letter where it is the usual paper, A4 everywhere else. */
const LETTER_REGIONS = new Set(['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'GT', 'CR', 'PR']);

export function defaultPaper(language: string | undefined): PaperId {
  try {
    const region = language ? new Intl.Locale(language).maximize().region : undefined;
    return region && !LETTER_REGIONS.has(region) ? 'a4' : 'letter';
  } catch {
    return 'letter';
  }
}

export function defaultSettings(language?: string): PrintSettings {
  return {
    paper: defaultPaper(language),
    gap: 0,
    scale: 100,
    skipBasics: true,
    cropMarks: true,
    blackCorners: false,
    bleed: false,
    watermark: false,
    decklist: false,
  };
}

const STORAGE_KEY = 'sc-proxy-print-settings';

/** Saved settings over the defaults, dropping anything no longer offered. */
export function readSettings(language?: string): PrintSettings {
  const base = defaultSettings(language);
  let saved: Partial<Record<keyof PrintSettings, unknown>> = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
  } catch {
    return base;
  }
  const bool = (k: keyof PrintSettings, fallback: boolean) =>
    typeof saved[k] === 'boolean' ? (saved[k] as boolean) : fallback;
  return {
    paper:
      typeof saved.paper === 'string' && saved.paper in PAPERS
        ? (saved.paper as PaperId)
        : base.paper,
    gap: (GAPS_MM as readonly unknown[]).includes(saved.gap) ? (saved.gap as number) : base.gap,
    scale: SCALES.includes(saved.scale as number) ? (saved.scale as number) : base.scale,
    skipBasics: bool('skipBasics', base.skipBasics),
    cropMarks: bool('cropMarks', base.cropMarks),
    blackCorners: bool('blackCorners', base.blackCorners),
    bleed: bool('bleed', base.bleed),
    watermark: bool('watermark', base.watermark),
    decklist: bool('decklist', base.decklist),
  };
}

export function writeSettings(settings: PrintSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* private mode or full storage: the settings just don't stick */
  }
}

export type LayoutSettings = Pick<PrintSettings, 'paper' | 'gap' | 'scale' | 'cropMarks' | 'bleed'>;

export interface SheetLayout {
  paper: { width: number; height: number };
  /** The printed block: cards plus crop-mark room, centered at the top margin. */
  width: number;
  height: number;
  /** Space the page offers inside its margins. */
  printableWidth: number;
  printableHeight: number;
  cols: number;
  rows: number;
  perPage: number;
  card: { width: number; height: number };
  bleed: number;
  /** Top-left corner of each card, in grid order. */
  cells: { x: number; y: number }[];
  /** Every cut line, once: x positions of the vertical cuts, y of the horizontal. */
  cutsX: number[];
  cutsY: number[];
}

// Float noise (3 × 88.2 > 264.6) must not cost a row.
const EPSILON = 1e-6;

const unique = (values: number[]) =>
  [...new Set(values.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);

export function sheetLayout(settings: LayoutSettings): SheetLayout {
  const paper = PAPERS[settings.paper];
  const s = settings.scale / 100;
  const card = { width: CARD_MM.width * s, height: CARD_MM.height * s };
  const bleed = settings.bleed ? BLEED_MM : 0;
  const gap = settings.gap;
  const markX = settings.cropMarks ? MARK_X_MM : 0;
  const markY = settings.cropMarks ? MARK_Y_MM : 0;
  const printableWidth = paper.width - 2 * PAGE_MARGIN_MM - WIDTH_SLACK_MM;
  const printableHeight = paper.height - 2 * PAGE_MARGIN_MM - HEIGHT_SLACK_MM;
  const pitchX = card.width + 2 * bleed + gap;
  const pitchY = card.height + 2 * bleed + gap;
  const fit = (room: number, mark: number, pitch: number) =>
    Math.max(1, Math.floor((room - 2 * mark + gap) / pitch + EPSILON));
  const cols = fit(printableWidth, markX, pitchX);
  const rows = fit(printableHeight, markY, pitchY);

  const cells: SheetLayout['cells'] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ x: markX + bleed + c * pitchX, y: markY + bleed + r * pitchY });
    }
  }
  const xs = cells.slice(0, cols).map((cell) => cell.x);
  const ys = cells.filter((_, i) => i % cols === 0).map((cell) => cell.y);
  return {
    paper: { width: paper.width, height: paper.height },
    width: cols * pitchX - gap + 2 * markX,
    height: rows * pitchY - gap + 2 * markY,
    printableWidth,
    printableHeight,
    cols,
    rows,
    perPage: cols * rows,
    card,
    bleed,
    cells,
    cutsX: unique(xs.flatMap((x) => [x, x + card.width])),
    cutsY: unique(ys.flatMap((y) => [y, y + card.height])),
  };
}

/**
 * When these settings fit fewer cards a page than the paper holds at real
 * size, the largest scale at or below this one that fits them all again.
 * Undefined when nothing is lost, or when no offered scale wins it back.
 */
export function fullPageScale(settings: LayoutSettings): number | undefined {
  const full = sheetLayout({ ...settings, scale: 100, gap: 0, bleed: false }).perPage;
  if (sheetLayout(settings).perPage >= full) return undefined;
  return SCALES.find(
    (scale) => scale < settings.scale && sheetLayout({ ...settings, scale }).perPage >= full
  );
}

export interface DecklistSection {
  title: string;
  lines: { qty: number; name: string }[];
}

/** The deck as a list to print: commanders, the deck, then the sideboard when asked. */
export function decklistSections(
  deck: Pick<Deck, 'commander' | 'partnerCommander' | 'cards' | 'sideboard'>,
  includeSideboard: boolean
): DecklistSection[] {
  const count = (names: string[]) => {
    const counts = new Map<string, number>();
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([name, qty]) => ({ qty, name }));
  };
  const commanders = [deck.commander, deck.partnerCommander].flatMap((c) => (c ? [c.name] : []));
  const sections: DecklistSection[] = [
    { title: commanders.length > 1 ? 'Commanders' : 'Commander', lines: count(commanders) },
    { title: 'Deck', lines: count(deck.cards.map((dc) => dc.card.name)) },
    {
      title: 'Sideboard',
      lines: includeSideboard ? count((deck.sideboard ?? []).map((dc) => dc.card.name)) : [],
    },
  ];
  return sections.filter((section) => section.lines.length > 0);
}
