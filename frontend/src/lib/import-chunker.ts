/**
 * Splits a collection-import file into smaller text chunks so the client can
 * upload them as separate requests. Long single-request imports (1k+ cards,
 * 30+ seconds of Scryfall resolution server-side) are fragile on mobile —
 * Android Chrome backgrounding the tab, a cellular handoff, or a flaky NAT
 * timeout all kill the in-flight POST and the page sees "server is not
 * responding." Chunking turns one ~30s request into N ~5s requests, each of
 * which can be retried independently.
 *
 * Each chunk must be independently parseable by the backend. For
 * CSV/TSV/ManaBox formats that means preserving the header row in every
 * chunk; for plain-text / MTGA lists there's no header so we just split.
 */

// Known column names from the formats backend/src/parsers/csv.ts recognizes
// (Archidekt, Moxfield, Deckbox, ManaBox, TCGplayer, generic CSV). Matched
// as whole tokens after splitting on the delimiter, so a card named
// "Counterspell" doesn't get mistaken for a header just because it contains
// "count".
const HEADER_TOKENS = new Set([
  'name',
  'card name',
  'cardname',
  'count',
  'quantity',
  'qty',
  'tradelist count',
  'set',
  'set code',
  'setcode',
  'set name',
  'setname',
  'edition',
  'edition code',
  'expansion',
  'expansion name',
  'collector number',
  'collectornumber',
  'card number',
  'cardnumber',
  'card #',
  'scryfall id',
  'scryfallid',
  'scryfall_id',
  'binder name',
  'binder type',
  'manabox id',
  'rarity',
  'foil',
  'is foil',
  'finish',
  'printing',
  'condition',
  'card condition',
  'language',
  'lang',
  'purchase price',
  'price',
  'price (usd)',
  'value',
  'unit price',
  'category',
  'folder',
  'tags',
  'collection',
  'altered',
  'alter',
]);

const DEFAULT_CHUNK_SIZE = 500;

/**
 * Mirrors the backend's header-detection logic (csv.ts:detectCsvFormat,
 * manabox.ts:looksLikeManabox): the line has a delimiter, and at least one
 * delimited token is exactly a known column name. Plain-text rows (MTGA,
 * "4 Sol Ring") have no delimiter so they fall through.
 */
function looksLikeHeader(line: string): boolean {
  if (!/[\t,;]/.test(line)) return false;
  const delim = line.includes('\t') ? '\t' : line.includes(';') && !line.includes(',') ? ';' : ',';
  const tokens = line.split(delim).map((t) =>
    t
      .trim()
      .toLowerCase()
      .replace(/^["']|["']$/g, '')
  );
  return tokens.some((t) => HEADER_TOKENS.has(t));
}

export function chunkImportText(text: string, chunkSize = DEFAULT_CHUNK_SIZE): string[] {
  if (chunkSize <= 0) throw new Error('chunkSize must be positive');

  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length === 0) return [text];

  const hasHeader = looksLikeHeader(lines[0]);
  const header = hasHeader ? lines[0] : null;
  const body = hasHeader ? lines.slice(1) : lines;

  if (body.length <= chunkSize) return [text];

  const chunks: string[] = [];
  for (let i = 0; i < body.length; i += chunkSize) {
    const slice = body.slice(i, i + chunkSize);
    chunks.push(header ? `${header}\n${slice.join('\n')}` : slice.join('\n'));
  }
  return chunks;
}
