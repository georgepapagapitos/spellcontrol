import { Pick } from './generate';

function sortedNames(picks: Pick[]): string[] {
  return picks.map((p) => p.card.name).sort((a, b) => a.localeCompare(b));
}

/**
 * CubeCobra / Cube Tutor bulk-import format: one card name per line.
 * Paste into CubeCobra's "Add Cards" to draft the generated cube.
 */
export function toCubeCobraList(picks: Pick[]): string {
  return sortedNames(picks).join('\n');
}

/**
 * Draftmancer's cube text format (https://draftmancer.com/cubeformat.html):
 * a `[Settings]` JSON block naming the cube, then one simple slot of card
 * lines. Load it from Draftmancer's cube import (file or paste).
 */
export function toDraftmancerCube(picks: Pick[], cubeName: string): string {
  const header = JSON.stringify({ name: cubeName }, null, 2);
  return `[Settings]\n${header}\n[Cube(15)]\n${sortedNames(picks).join('\n')}\n`;
}

/** The printing a CubeCobra CSV row can pin: the user's own copy, when they own one. */
export interface CsvPrinting {
  setCode: string;
  collectorNumber: string;
}

// CubeCobra's CSV export header, in its column order. Its CSV upload reads
// the same columns, so a file written here round-trips through CubeCobra.
const CUBECOBRA_CSV_HEADER = [
  'name',
  'CMC',
  'Type',
  'Color',
  'Set',
  'Collector Number',
  'Rarity',
  'Color Category',
  'status',
  'Finish',
  'maybeboard',
  'image URL',
  'image Back URL',
  'tags',
  'Notes',
  'MTGO ID',
];

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * CubeCobra's CSV: name, CMC, type and colors from the pick, plus Set and
 * Collector Number when `printingFor` knows the user's copy. Upload it from a
 * cube's Edit → Bulk upload.
 */
export function toCubeCobraCsv(
  picks: Pick[],
  printingFor?: (name: string) => CsvPrinting | null | undefined
): string {
  const rows = [...picks]
    .sort((a, b) => a.card.name.localeCompare(b.card.name))
    .map((p) => {
      const printing = printingFor?.(p.card.name);
      return [
        p.card.name,
        String(p.card.cmc),
        p.card.typeLine,
        p.card.colors.join(''),
        printing?.setCode.toLowerCase() ?? '',
        printing?.collectorNumber ?? '',
        '',
        '',
        'Owned',
        'Non-foil',
        'false',
        '',
        '',
        '',
        '',
        '',
      ]
        .map(csvCell)
        .join(',');
    });
  return [CUBECOBRA_CSV_HEADER.join(','), ...rows].join('\n') + '\n';
}

/** A safe download name for a cube: `<cube-name>-<suffix>.<ext>`. */
export function cubeExportFileName(cubeName: string, suffix: string, ext: 'txt' | 'csv'): string {
  const stem =
    cubeName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'cube';
  return `${stem}-${suffix}.${ext}`;
}
