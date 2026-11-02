import type { ImportRow, ParseResult } from './types';

/**
 * MTGO `.dek` import: the XML `<Deck>` document with one
 * `<Cards CatID Quantity Sideboard Name/>` tag per card.
 *
 * Hand-rolled on purpose. A `.dek` is flat (no nesting that matters) and a
 * real XML parser would bring DOCTYPE and entity expansion with it. Here
 * there is none by construction: the only entities decoded are the five
 * predefined ones plus numeric references, so a hostile file cannot expand
 * anything.
 */

const DECK_ROOT = /<Deck[\s>]/i;
const CARDS_TAG = /<Cards\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITY = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|apos|quot|lt|gt));/g;
const NAMED: Record<string, string> = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>' };

export function looksLikeMtgo(text: string): boolean {
  return DECK_ROOT.test(text) && /<Cards\b/i.test(text);
}

function decodeEntities(s: string): string {
  return s.replace(ENTITY, (whole, dec, hex, named) => {
    if (named) return NAMED[named];
    const cp = dec !== undefined ? parseInt(dec, 10) : parseInt(hex, 16);
    if (!Number.isFinite(cp) || cp < 1 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      return whole;
    }
    return String.fromCodePoint(cp);
  });
}

export function parseMtgo(text: string): ParseResult {
  const rows: ImportRow[] = [];
  const unparsedLines: string[] = [];
  const body = text.replace(/<!--[\s\S]*?-->/g, '');

  for (const tag of body.matchAll(CARDS_TAG)) {
    const attrs: Record<string, string> = {};
    for (const a of tag[1].matchAll(ATTR)) {
      attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? '');
    }
    const name = (attrs.name ?? '').trim();
    if (!name) {
      unparsedLines.push(tag[0]);
      continue;
    }
    const quantity = parseInt(attrs.quantity ?? '', 10);
    rows.push({
      name,
      quantity: quantity > 0 ? quantity : 1,
      sourceFormat: 'mtgo',
      ...(attrs.sideboard?.toLowerCase() === 'true' ? { section: 'sideboard' } : {}),
    });
  }

  return { rows, format: 'mtgo', unparsedLines, skippedUnownedRows: 0 };
}
