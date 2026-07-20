import type { EnrichedCard } from '../types';

/**
 * Minimal card shape the export engine needs to resolve a printing and format
 * a line — just `name`/`set`/`collector_number`. Both `ScryfallCard` (deck
 * editor) and the public-share payload's `PublicDeckCard['card']` shape
 * (shared deck view) satisfy this structurally, so neither call site needs
 * adapter code.
 */
export interface ExportableCard {
  name: string;
  set?: string;
  collector_number?: string;
}

/** One deck/sideboard slot: a card plus the collection copy (if any)
 *  allocated to it. `DeckDisplayCard` already satisfies this shape. */
export interface ExportCardSlot {
  card: ExportableCard;
  allocatedCopyId?: string | null;
}

export type ExportFormat = 'mtga' | 'plain' | 'moxfield';

const EXPORT_FORMAT_STORAGE_KEY = 'mtg-decks-export-format';

export function readStoredExportFormat(): ExportFormat {
  if (typeof window === 'undefined') return 'mtga';
  try {
    const v = window.localStorage.getItem(EXPORT_FORMAT_STORAGE_KEY);
    if (v === 'mtga' || v === 'plain' || v === 'moxfield') return v;
  } catch {
    /* ignore */
  }
  return 'mtga';
}

export function writeStoredExportFormat(format: ExportFormat): void {
  try {
    window.localStorage.setItem(EXPORT_FORMAT_STORAGE_KEY, format);
  } catch {
    /* ignore */
  }
}

type PrintingFinish = 'nonfoil' | 'foil' | 'etched';

export interface ExportEntry {
  name: string;
  set: string;
  collectorNumber: string;
  qty: number;
  finish: PrintingFinish;
  language?: string;
}

export function formatLine(entry: ExportEntry, format: ExportFormat): string {
  const { name, qty, finish, language } = entry;
  const set = entry.set.toUpperCase();
  const num = entry.collectorNumber;
  const lang = language && language !== 'en' ? language.toUpperCase() : '';
  switch (format) {
    case 'mtga': {
      // Arena syntax doesn't carry foil; printings still distinguished by set+cn.
      if (set && num) return `${qty} ${name} (${set}) ${num}`;
      return `${qty} ${name}`;
    }
    case 'moxfield': {
      // Moxfield: `1 Sol Ring (CMR) 472 *F*` / `*E*` for etched.
      const finishTag = finish === 'foil' ? ' *F*' : finish === 'etched' ? ' *E*' : '';
      if (set && num) return `${qty} ${name} (${set}) ${num}${finishTag}`;
      if (set) return `${qty} ${name} (${set})${finishTag}`;
      return `${qty} ${name}${finishTag}`;
    }
    case 'plain':
    default: {
      // Plain text: human-readable. Always identify printing when known.
      const parts: string[] = [`${qty} ${name}`];
      if (set && num) parts.push(`(${set}) ${num}`);
      else if (set) parts.push(`(${set})`);
      if (finish === 'foil') parts.push('[Foil]');
      else if (finish === 'etched') parts.push('[Etched]');
      if (lang) parts.push(`[${lang}]`);
      return parts.join(' ');
    }
  }
}

function entryKey(
  e: Pick<ExportEntry, 'name' | 'set' | 'collectorNumber' | 'finish' | 'language'>
): string {
  return [e.name, e.set, e.collectorNumber, e.finish, e.language ?? ''].join('|');
}

/**
 * Resolve the effective printing for a deck slot. When the slot has an
 * allocated physical copy, the copy's set/collector_number/finish/language
 * win — that's the actual card the user owns and will pull from their box.
 * The slot's stored `card` is only used as a fallback when no copy is
 * allocated (or when the lookup fails).
 */
export function resolvePrinting(
  card: ExportableCard,
  allocatedCopyId: string | null | undefined,
  collectionByCopyId?: Map<string, EnrichedCard>
): {
  name: string;
  set: string;
  collectorNumber: string;
  finish: PrintingFinish;
  language?: string;
} {
  if (allocatedCopyId && collectionByCopyId) {
    const copy = collectionByCopyId.get(allocatedCopyId);
    if (copy) {
      const finish = (copy.finish ?? (copy.foil ? 'foil' : 'nonfoil')) as PrintingFinish;
      return {
        name: copy.name || card.name,
        set: copy.setCode || card.set || '',
        collectorNumber: copy.collectorNumber || card.collector_number || '',
        finish,
        language: copy.language,
      };
    }
  }
  return {
    name: card.name,
    set: card.set || '',
    collectorNumber: card.collector_number || '',
    finish: 'nonfoil',
  };
}

export function groupAndSort(
  cards: ExportCardSlot[],
  collectionByCopyId?: Map<string, EnrichedCard>
): ExportEntry[] {
  const grouped = new Map<string, ExportEntry>();
  for (const dc of cards) {
    const printing = resolvePrinting(dc.card, dc.allocatedCopyId, collectionByCopyId);
    const key = entryKey(printing);
    const existing = grouped.get(key);
    if (existing) {
      existing.qty += 1;
    } else {
      grouped.set(key, { ...printing, qty: 1 });
    }
  }
  return [...grouped.values()].sort((a, b) => {
    const n = a.name.localeCompare(b.name);
    if (n !== 0) return n;
    const s = a.set.localeCompare(b.set);
    if (s !== 0) return s;
    const cn = a.collectorNumber.localeCompare(b.collectorNumber);
    if (cn !== 0) return cn;
    return a.finish.localeCompare(b.finish);
  });
}

export interface BuildExportInput {
  commander?: ExportableCard | null;
  partner?: ExportableCard | null;
  cards: ExportCardSlot[];
  sideboard?: ExportCardSlot[];
  collectionByCopyId?: Map<string, EnrichedCard>;
  commanderAllocatedCopyId?: string | null;
  partnerAllocatedCopyId?: string | null;
}

export function buildExport(input: BuildExportInput, format: ExportFormat): string {
  const {
    commander = null,
    partner = null,
    cards,
    sideboard = [],
    collectionByCopyId,
    commanderAllocatedCopyId,
    partnerAllocatedCopyId,
  } = input;
  const lines: string[] = [];
  const cmdEntry = (card: ExportableCard, copyId: string | null | undefined): ExportEntry => {
    const printing = resolvePrinting(card, copyId ?? null, collectionByCopyId);
    return { ...printing, qty: 1 };
  };
  if (format === 'mtga' && (commander || partner)) {
    lines.push('Commander');
    if (commander) lines.push(formatLine(cmdEntry(commander, commanderAllocatedCopyId), format));
    if (partner) lines.push(formatLine(cmdEntry(partner, partnerAllocatedCopyId), format));
    lines.push('');
    lines.push('Deck');
  } else {
    if (commander) lines.push(formatLine(cmdEntry(commander, commanderAllocatedCopyId), format));
    if (partner) lines.push(formatLine(cmdEntry(partner, partnerAllocatedCopyId), format));
  }

  for (const entry of groupAndSort(cards, collectionByCopyId)) {
    lines.push(formatLine(entry, format));
  }

  if (sideboard.length > 0) {
    lines.push('');
    lines.push('Sideboard');
    for (const entry of groupAndSort(sideboard, collectionByCopyId)) {
      lines.push(formatLine(entry, format));
    }
  }
  return lines.join('\n');
}
