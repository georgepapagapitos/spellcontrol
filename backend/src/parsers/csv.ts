import type { ImportFormat, ImportRow, ParseResult } from './types';

/**
 * Common column-name aliases across collection tools. We map any known alias to our normalized field.
 * This lets us handle Archidekt, Moxfield, Deckbox, TCGplayer, Cardsphere, and others
 * via one code path — they just label things differently.
 */
const HEADER_ALIASES: Record<string, keyof FieldMap> = {
  // Name
  name: 'name',
  'card name': 'name',
  cardname: 'name',

  // Set code
  'set code': 'setCode',
  setcode: 'setCode',
  set: 'setCode',
  edition: 'setCode',
  'edition code': 'setCode',
  expansion: 'setCode',
  'set abbreviation': 'setCode',

  // Set name
  'set name': 'setName',
  setname: 'setName',
  'edition name': 'setName',
  'expansion name': 'setName',

  // Collector number
  'collector number': 'collectorNumber',
  'card number': 'collectorNumber',
  cardnumber: 'collectorNumber',
  collectornumber: 'collectorNumber',
  'card #': 'collectorNumber',

  // Foil
  foil: 'foil',
  'is foil': 'foil',
  finish: 'foil', // values like "foil" / "nonfoil"
  printing: 'foil', // values like "Foil" / "Normal"

  // Quantity
  quantity: 'quantity',
  count: 'quantity',
  qty: 'quantity',
  'tradelist count': 'quantity', // Moxfield

  // Rarity
  rarity: 'rarity',

  // Scryfall ID
  'scryfall id': 'scryfallId',
  scryfallid: 'scryfallId',
  'scryfall_id': 'scryfallId',

  // Price
  'purchase price': 'purchasePrice',
  price: 'purchasePrice',
  'price (usd)': 'purchasePrice',
  value: 'purchasePrice',
  'unit price': 'purchasePrice',

  // Source category — varies wildly, take any one
  'binder name': 'sourceCategory',
  category: 'sourceCategory',
  folder: 'sourceCategory',
  tags: 'sourceCategory',
  collection: 'sourceCategory',
};

interface FieldMap {
  name: number;
  setCode: number;
  setName: number;
  collectorNumber: number;
  foil: number;
  quantity: number;
  rarity: number;
  scryfallId: number;
  purchasePrice: number;
  sourceCategory: number;
}

const EMPTY_MAP: FieldMap = {
  name: -1,
  setCode: -1,
  setName: -1,
  collectorNumber: -1,
  foil: -1,
  quantity: -1,
  rarity: -1,
  scryfallId: -1,
  purchasePrice: -1,
  sourceCategory: -1,
};

/**
 * Best-effort detection: pick whichever known format matches the most header signatures.
 * Falls back to 'generic-csv' for anything that has at least a name column.
 */
export function detectCsvFormat(headers: string[]): ImportFormat | null {
  const lower = headers.map((h) => h.toLowerCase().trim());

  if (lower.includes('scryfall id') && lower.includes('binder name')) return 'manabox';
  if (lower.includes('count') && lower.includes('tradelist count') && lower.includes('edition'))
    return 'moxfield';
  if (
    (lower.includes('name') || lower.includes('card name')) &&
    (lower.includes('edition') || lower.includes('edition code')) &&
    lower.includes('quantity')
  ) {
    // Could be Archidekt or Deckbox — the difference doesn't matter because we use the same mapper
    return 'archidekt';
  }
  if (lower.includes('name') || lower.includes('card name')) return 'generic-csv';
  return null;
}

export function parseCsvAuto(text: string, format: ImportFormat): ParseResult {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.length < 2) return { rows: [], format, unparsedLines: [] };

  const delim = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delim);
  const fieldMap = buildFieldMap(headers);

  if (fieldMap.name === -1) {
    return { rows: [], format, unparsedLines: lines.slice(1) };
  }

  const rows: ImportRow[] = [];
  const unparsedLines: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const vals = splitCsvLine(line, delim);
    const name = vals[fieldMap.name]?.trim();
    if (!name) {
      unparsedLines.push(line);
      continue;
    }

    rows.push({
      name,
      quantity: parseQuantity(vals[fieldMap.quantity]),
      setCode: fieldMap.setCode >= 0 ? vals[fieldMap.setCode] || undefined : undefined,
      setName: fieldMap.setName >= 0 ? vals[fieldMap.setName] || undefined : undefined,
      collectorNumber:
        fieldMap.collectorNumber >= 0 ? vals[fieldMap.collectorNumber] || undefined : undefined,
      foil: fieldMap.foil >= 0 ? parseFoil(vals[fieldMap.foil]) : undefined,
      rarity:
        fieldMap.rarity >= 0
          ? (vals[fieldMap.rarity] || '').toLowerCase() || undefined
          : undefined,
      scryfallId: fieldMap.scryfallId >= 0 ? vals[fieldMap.scryfallId] || undefined : undefined,
      purchasePrice: fieldMap.purchasePrice >= 0 ? parsePrice(vals[fieldMap.purchasePrice]) : undefined,
      sourceCategory:
        fieldMap.sourceCategory >= 0 ? vals[fieldMap.sourceCategory] || undefined : undefined,
      sourceFormat: format,
    });
  }

  return { rows, format, unparsedLines };
}

function buildFieldMap(headers: string[]): FieldMap {
  const map: FieldMap = { ...EMPTY_MAP };
  headers.forEach((h, i) => {
    const key = HEADER_ALIASES[h.toLowerCase().trim()];
    if (key && map[key] === -1) {
      map[key] = i;
    }
  });
  return map;
}

function detectDelimiter(headerLine: string): string {
  if (headerLine.includes('\t')) return '\t';
  if (headerLine.includes(';') && !headerLine.includes(',')) return ';';
  return ',';
}

/**
 * CSV-line splitter that handles double-quoted fields. Not RFC-4180-perfect but covers
 * the common cases in collection-tool exports (quoted commas, doubled quotes inside quotes).
 */
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === delim) {
        out.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function parseQuantity(raw: string | undefined): number {
  if (!raw) return 1;
  const n = parseInt(raw);
  return isFinite(n) && n > 0 ? n : 1;
}

function parsePrice(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[$,]/g, '').trim();
  if (cleaned === '' || cleaned === '-') return undefined;
  const p = parseFloat(cleaned);
  if (!isFinite(p) || isNaN(p) || p < 0 || p > 10000) return undefined;
  return p;
}

function parseFoil(raw: string | undefined): boolean | undefined {
  if (!raw) return undefined;
  const v = raw.toLowerCase().trim();
  if (v === 'foil' || v === 'true' || v === '1' || v === 'yes' || v === 'y') return true;
  if (v === 'normal' || v === 'nonfoil' || v === 'non-foil' || v === 'false' || v === '0' || v === 'no' || v === 'n' || v === '') return false;
  return undefined;
}
