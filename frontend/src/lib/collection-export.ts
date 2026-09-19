import type { Condition, EnrichedCard } from '../types';
import { safeName } from './backup';
import { formatLine } from './deck-export';

/**
 * Collection export in the file shapes other tools import. Every CSV format
 * writes ONE ROW PER PHYSICAL COPY (Quantity/Count is always 1) so nothing
 * that distinguishes two copies of the same printing — condition, language,
 * cost basis, price override, altered/proxy/misprint, binder — collapses
 * into a shared row. The row count in the file therefore equals the card
 * count in the app. The Arena text list is the one exception: it carries
 * no per-copy data at all, so it groups identical printings with a count,
 * exactly as its deck-list syntax expects.
 */
export type CollectionExportFormat = 'spellcontrol' | 'moxfield' | 'archidekt' | 'mtga';

export const COLLECTION_EXPORT_FORMATS: {
  value: CollectionExportFormat;
  label: string;
  description: string;
}[] = [
  {
    value: 'spellcontrol',
    label: 'SpellControl CSV',
    description:
      'Every field, ManaBox-compatible. One row per copy. Re-imports here with nothing lost.',
  },
  {
    value: 'moxfield',
    label: 'Moxfield CSV',
    description: "Moxfield's collection import columns. One row per copy.",
  },
  {
    value: 'archidekt',
    label: 'Archidekt CSV',
    description: "Archidekt's collection import columns, with Scryfall IDs. One row per copy.",
  },
  {
    value: 'mtga',
    label: 'Arena text list',
    description: '1 Sol Ring (CMR) 472 per line. Identical printings share a line with a count.',
  },
];

const STORAGE_KEY = 'sc-collection-export-format';

export function readStoredCollectionExportFormat(): CollectionExportFormat {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (COLLECTION_EXPORT_FORMATS.some((f) => f.value === v)) return v as CollectionExportFormat;
  } catch {
    /* ignore */
  }
  return 'spellcontrol';
}

export function writeStoredCollectionExportFormat(format: CollectionExportFormat): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, format);
  } catch {
    /* ignore */
  }
}

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvRow(values: string[]): string {
  return values.map(csvField).join(',');
}

function csv(headers: string[], cards: EnrichedCard[], row: (c: EnrichedCard) => string[]): string {
  return [csvRow(headers), ...cards.map((c) => csvRow(row(c)))].join('\n');
}

const MANABOX_CONDITION: Record<Condition, string> = {
  nm: 'near_mint',
  lp: 'lightly_played',
  mp: 'moderately_played',
  hp: 'heavily_played',
  damaged: 'damaged',
};
const MOXFIELD_CONDITION: Record<Condition, string> = {
  nm: 'Near Mint',
  lp: 'Lightly Played',
  mp: 'Moderately Played',
  hp: 'Heavily Played',
  damaged: 'Damaged',
};
const ARCHIDEKT_CONDITION: Record<Condition, string> = {
  nm: 'NM',
  lp: 'LP',
  mp: 'MP',
  hp: 'HP',
  damaged: 'D',
};
/** Scryfall language code → the full name Moxfield writes. Unknown codes pass through. */
const LANGUAGE_NAME: Record<string, string> = {
  en: 'English',
  ja: 'Japanese',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
  ko: 'Korean',
  zhs: 'Chinese Simplified',
  zht: 'Chinese Traditional',
  ph: 'Phyrexian',
};

const money = (n: number | undefined) => (n != null && n > 0 ? n.toFixed(2) : '');
const bool = (b: boolean | undefined) => (b ? 'TRUE' : 'FALSE');
const condition = (c: EnrichedCard, table: Record<Condition, string>) =>
  c.condition ? table[c.condition] : '';
const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (ms: number | undefined) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/**
 * ManaBox-compatible, plus every per-copy field this app holds. Headers are
 * ones `backend/src/parsers/csv.ts`'s HEADER_ALIASES recognise, and the
 * "Scryfall ID" + "Binder name" pair is `detectCsvFormat`'s manabox
 * signature, so the file round-trips straight back through Add cards →
 * Upload. "Purchase price" is `acquiredPrice` (cost basis); "Market price"
 * is the live value at export time (`purchasePrice`, see merge-card.ts).
 * Columns the parser has no alias for (price override, market price, oracle
 * id, copy id, last edited) are carried for spreadsheets and ignored on
 * re-import.
 */
function spellcontrolCsv(cards: EnrichedCard[], currency: string): string {
  return csv(
    [
      'Name',
      'Set code',
      'Set name',
      'Collector number',
      'Foil',
      'Rarity',
      'Quantity',
      'Scryfall ID',
      'Purchase price',
      'Purchase currency',
      'Condition',
      'Language',
      'Binder name',
      'Altered',
      'Proxy',
      'Misprint',
      'Price override',
      'Price override currency',
      `Market price (${currency})`,
      'Oracle ID',
      'Type line',
      'Mana value',
      'Color identity',
      'Last edited',
      'Copy ID',
    ],
    cards,
    (c) => [
      c.name,
      c.setCode,
      c.setName,
      c.collectorNumber,
      c.finish === 'nonfoil' ? 'normal' : c.finish,
      c.rarity,
      '1',
      c.scryfallId,
      money(c.acquiredPrice),
      c.acquiredPrice ? (c.acquiredCurrency ?? 'USD') : '',
      condition(c, MANABOX_CONDITION),
      c.language ?? '',
      c.sourceCategory ?? '',
      bool(c.altered),
      bool(c.proxy),
      bool(c.misprint),
      money(c.priceOverride),
      c.priceOverride ? (c.priceOverrideCurrency ?? 'USD') : '',
      money(c.purchasePrice),
      c.oracleId ?? '',
      c.typeLine ?? '',
      c.cmc != null ? String(c.cmc) : '',
      (c.colorIdentity ?? []).join(''),
      stamp(c.updatedAt),
      c.copyId,
    ]
  );
}

/** Moxfield's collection CSV: its own export header, which its importer reads back. */
function moxfieldCsv(cards: EnrichedCard[]): string {
  return csv(
    [
      'Count',
      'Tradelist Count',
      'Name',
      'Edition',
      'Condition',
      'Language',
      'Foil',
      'Tags',
      'Last Modified',
      'Collector Number',
      'Alter',
      'Proxy',
      'Purchase Price',
    ],
    cards,
    (c) => [
      '1',
      '0',
      c.name,
      c.setCode.toLowerCase(),
      condition(c, MOXFIELD_CONDITION),
      c.language ? (LANGUAGE_NAME[c.language] ?? c.language) : 'English',
      c.finish === 'nonfoil' ? '' : c.finish,
      c.sourceCategory ?? '',
      stamp(c.updatedAt),
      c.collectorNumber,
      bool(c.altered),
      bool(c.proxy),
      money(c.acquiredPrice),
    ]
  );
}

/** Archidekt's collection CSV columns; Scryfall ID pins the exact printing. */
function archidektCsv(cards: EnrichedCard[]): string {
  return csv(
    [
      'Quantity',
      'Name',
      'Finish',
      'Condition',
      'Date Added',
      'Language',
      'Purchase Price',
      'Tags',
      'Edition Name',
      'Edition Code',
      'Scryfall ID',
      'Collector Number',
    ],
    cards,
    (c) => [
      '1',
      c.name,
      c.finish === 'nonfoil' ? 'Normal' : c.finish === 'foil' ? 'Foil' : 'Etched',
      condition(c, ARCHIDEKT_CONDITION),
      stamp(c.updatedAt),
      (c.language ?? 'en').toUpperCase(),
      money(c.acquiredPrice),
      c.sourceCategory ?? '',
      c.setName,
      c.setCode.toLowerCase(),
      c.scryfallId,
      c.collectorNumber,
    ]
  );
}

function arenaText(cards: EnrichedCard[]): string {
  const groups = new Map<string, { name: string; set: string; cn: string; qty: number }>();
  for (const c of cards) {
    const key = `${c.name}|${c.setCode}|${c.collectorNumber}`;
    const g = groups.get(key);
    if (g) g.qty += 1;
    else groups.set(key, { name: c.name, set: c.setCode, cn: c.collectorNumber, qty: 1 });
  }
  return [...groups.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.set.localeCompare(b.set))
    .map((g) =>
      formatLine(
        { name: g.name, set: g.set, collectorNumber: g.cn, qty: g.qty, finish: 'nonfoil' },
        'mtga'
      )
    )
    .join('\n');
}

export function collectionToExport(
  cards: EnrichedCard[],
  format: CollectionExportFormat,
  currency = 'USD'
): string {
  switch (format) {
    case 'moxfield':
      return moxfieldCsv(cards);
    case 'archidekt':
      return archidektCsv(cards);
    case 'mtga':
      return arenaText(cards);
    default:
      return spellcontrolCsv(cards, currency);
  }
}

export function collectionExportFileName(
  format: CollectionExportFormat,
  binderName?: string,
  now: Date = new Date()
): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const stem = binderName ? `binder-${safeName(binderName)}` : 'collection';
  const tag = format === 'spellcontrol' ? '' : `-${format}`;
  return `spellcontrol-${stem}${tag}-${date}.${format === 'mtga' ? 'txt' : 'csv'}`;
}

export function downloadText(text: string, fileName: string): void {
  const blob = new Blob([text], { type: fileName.endsWith('.csv') ? 'text/csv' : 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
