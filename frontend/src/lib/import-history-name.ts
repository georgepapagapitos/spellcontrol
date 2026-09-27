/**
 * Replace an internal import-history label ('pasted-list', 'scanned-cards',
 * 'retried-cards') with a friendlier name that names the detected text
 * format ("Pasted MTGA list", "Pasted Moxfield CSV", etc). A real filename
 * passes through unchanged. Shared by UploadPanel's re-import gate copy and
 * ImportHistorySheet's list rows.
 */
export function prettyImportName(name: string, format: string): string {
  if (name === 'scanned-cards') return 'Scanned cards';
  if (name === 'retried-cards') return 'Retried cards';
  if (name !== 'pasted-list') return name;
  switch ((format || '').toLowerCase()) {
    case 'mtga':
      return 'Pasted MTGA list';
    case 'plain':
      return 'Pasted text';
    case 'manabox':
      return 'Pasted ManaBox CSV';
    case 'archidekt':
      return 'Pasted Archidekt CSV';
    case 'moxfield':
      return 'Pasted Moxfield CSV';
    case 'deckbox':
      return 'Pasted Deckbox CSV';
    case 'generic-csv':
      return 'Pasted CSV';
    default:
      return 'Pasted list';
  }
}
