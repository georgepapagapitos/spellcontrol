import type { ParseResult } from './types';
import { looksLikeManabox, parseManabox } from './manabox';
import { detectCsvFormat, parseCsvAuto } from './csv';
import { parseTextList } from './text';

/**
 * Detects the input format and dispatches to the appropriate parser.
 *
 * Detection order:
 *   1. ManaBox TSV (most specific signature)
 *   2. Generic CSV with detected headers (Archidekt, Moxfield, Deckbox, etc.)
 *   3. Text list (MTGA-style or plain card names)
 *
 * The parsers all produce normalized ImportRow[] regardless of source.
 */
export function parseImport(text: string): ParseResult {
  if (!text.trim()) {
    return { rows: [], format: 'plain', unparsedLines: [] };
  }

  if (looksLikeManabox(text)) {
    return parseManabox(text);
  }

  // Try CSV detection — if the first line has multiple delimiter-separated tokens
  // and at least one looks like a header, assume CSV.
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const hasDelim = firstLine.includes(',') || firstLine.includes('\t') || firstLine.includes(';');
  if (hasDelim) {
    const delim = firstLine.includes('\t') ? '\t' : firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
    const headers = firstLine.split(delim).map((h) => h.trim().replace(/^"|"$/g, ''));
    const csvFormat = detectCsvFormat(headers);
    if (csvFormat) {
      return parseCsvAuto(text, csvFormat);
    }
  }

  // Fall through: treat as a text list (MTGA format or plain names).
  return parseTextList(text);
}

export type { ImportRow, ImportFormat, ParseResult } from './types';
