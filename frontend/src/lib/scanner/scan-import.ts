import type { UploadResponse } from '@/types/index';
import type { ImportMode } from '@/store/collection';
import type { ScannedEntry } from './use-scan-queue';
import { importText } from '@/lib/api';

/** Label a batch of pure camera scans is stamped with in the collection
 *  history. */
export const SCANNED_CARDS_LABEL = 'scanned-cards';
/**
 * Label a batch touched by the Add-cards sheet's Search tab (a searched row,
 * or a mix of scanned and searched rows) is stamped with (T153). Import
 * history shows it as "Add list" (`prettyImportName`).
 */
export const ADD_LIST_LABEL = 'add-list';

/**
 * Outcome of committing a batch to the collection. `added` is what the
 * parser actually resolved (may differ from `requested` if the parser
 * dedupes or drops a name); `unresolved` is how many rows Scryfall couldn't
 * match. Callers build their own user-facing copy from these — the FAB shows
 * a toast, the Add-cards sheet shows the routing summary — so the shared
 * helper deliberately returns data, not a message.
 */
export interface ScanImportResult {
  added: number;
  requested: number;
  unresolved: number;
  /** Rows withheld because the card service was unreachable — retryable from the import panel. */
  fetchErrors: number;
  /** The import-history id the batch landed under, for the routing summary + Undo. */
  importId: string;
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(vals: (string | number)[]): string {
  return vals.map(csvCell).join(',');
}

/**
 * One physical-copy row per queue entry, as a generic CSV the import parser
 * already understands (`backend/src/parsers/csv.ts`, auto-detected by
 * `parsers/index.ts`). The Scryfall ID column resolves the EXACT printing
 * (decision B: "+" adds whatever printing is showing) and Foil/Condition/
 * Language round-trip every per-copy detail the queue carries — the old
 * MTGA-style plain-text line the scanner used to emit has no language
 * column, so this format replaced it (T153) instead of gaining a second one.
 * Used both by the scanner (`CardScanner`'s own confirm) and the Add-cards
 * sheet's Add-list commit below.
 */
export function entriesToImportCsv(entries: ScannedEntry[]): string {
  const header = csvRow([
    'Name',
    'Scryfall ID',
    'Set Code',
    'Collector Number',
    'Foil',
    'Quantity',
    'Condition',
    'Language',
  ]);
  const rows = entries.map((e) =>
    csvRow([
      e.card.name,
      e.card.id,
      e.card.set,
      e.card.collector_number ?? '',
      e.finish,
      e.qty,
      e.condition ?? '',
      e.language ?? '',
    ])
  );
  return [header, ...rows].join('\n');
}

/**
 * Commit a scanned-card CSV to the collection.
 *
 * Both scanner entry points (the native FAB and the Add-cards sheet's Scan
 * tab) run the exact same flow on confirm: `CardScanner` builds the CSV
 * (`entriesToImportCsv`) from its queue, this parses it and merges the
 * result into the collection under the `scanned-cards` label. Scanning a
 * physical pile is always additive, so the mode is hard-wired to `merge` —
 * the replace / import-as-binder modes only matter for file/paste flows.
 */
export async function importScannedCards(
  text: string,
  requested: number,
  importCards: (response: UploadResponse, fileName: string, mode: ImportMode) => Promise<string>
): Promise<ScanImportResult> {
  const response = await importText(text);
  const importId = await importCards(response, SCANNED_CARDS_LABEL, 'merge');
  return {
    added: response.cards.length,
    requested,
    unresolved: response.unresolvedNames.length,
    fetchErrors: response.fetchErrors.length,
    importId,
  };
}

/**
 * The import-history label for one Add-list commit: a batch that's entirely
 * camera scans keeps the 'scanned-cards' label; anything with a searched/
 * picked row — including a batch that mixes both origins — is one
 * 'add-list' import. Legacy queue rows persisted before `source` existed
 * read as 'scanned', matching their only origin at the time.
 */
function importLabel(entries: ScannedEntry[]): string {
  return entries.every((e) => (e.source ?? 'scanned') === 'scanned')
    ? SCANNED_CARDS_LABEL
    : ADD_LIST_LABEL;
}

/**
 * Commit Add-list entries (scanned, searched, or a mix) to the collection as
 * one import — the Add-cards sheet's Add-list bar/review. One `importText` +
 * `importCards` call for the whole batch, same as `importScannedCards`, but
 * takes the queue entries directly so it can label a mixed/searched batch
 * 'add-list' instead of 'scanned-cards'.
 */
export async function importEntries(
  entries: ScannedEntry[],
  importCards: (response: UploadResponse, fileName: string, mode: ImportMode) => Promise<string>
): Promise<ScanImportResult> {
  const requested = entries.reduce((n, e) => n + e.qty, 0);
  const response = await importText(entriesToImportCsv(entries));
  const importId = await importCards(response, importLabel(entries), 'merge');
  return {
    added: response.cards.length,
    requested,
    unresolved: response.unresolvedNames.length,
    fetchErrors: response.fetchErrors.length,
    importId,
  };
}
