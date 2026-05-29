import type { UploadResponse } from '../types';
import type { ImportMode } from '../store/collection';
import { importText } from './api';

/** Label every scanner import is stamped with in the collection history. */
export const SCANNED_CARDS_LABEL = 'scanned-cards';

/**
 * Outcome of committing a scanner queue to the collection. `added` is what
 * the parser actually resolved (may differ from `requested` if the parser
 * dedupes or drops a name); `unresolved` is how many scanned names Scryfall
 * couldn't match. Callers build their own user-facing copy from these — the
 * FAB shows a toast, the Add-cards sheet shows an inline banner — so the
 * shared helper deliberately returns data, not a message.
 */
export interface ScanImportResult {
  added: number;
  requested: number;
  unresolved: number;
}

/**
 * Commit a scanned-card list to the collection.
 *
 * Both scanner entry points (the native FAB and the Add-cards sheet's Scan
 * tab) run the exact same flow on confirm: push the queue's text through the
 * import parser, then merge the result into the collection under the
 * `scanned-cards` label. Scanning a physical pile is always additive, so the
 * mode is hard-wired to `merge` — the replace / import-as-binder modes only
 * matter for file/paste flows. This is the single source of that convention.
 */
export async function importScannedCards(
  text: string,
  requested: number,
  importCards: (response: UploadResponse, fileName: string, mode: ImportMode) => Promise<string>
): Promise<ScanImportResult> {
  const response = await importText(text);
  await importCards(response, SCANNED_CARDS_LABEL, 'merge');
  return {
    added: response.cards.length,
    requested,
    unresolved: response.unresolvedNames.length,
  };
}
