import type { DeckSections } from '../deck-import';
import type { ProductSummary } from '../products';
import type { ScryfallCard } from '../types';

/** The deck id a precon is stored under in the house account. */
export function preconDeckId(fileName: string): string {
  return `precon-${fileName}`;
}

/** A MTGJSON `YYYY-MM-DD` release date as epoch ms, or null when absent or malformed. */
export function releaseDateMs(releaseDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) return null;
  const ms = Date.parse(`${releaseDate}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Deck names for a catalogue. Wizards reprints some precons under the same
 * name (Heavenly Inferno is both a 2011 deck and an Anthology reprint), and two
 * identical tiles would read as a duplicate. So a repeated name gets its
 * release year; a unique one stays as printed.
 */
export function preconNames(products: ProductSummary[]): Map<string, string> {
  const seen = new Map<string, number>();
  for (const p of products) seen.set(p.name, (seen.get(p.name) ?? 0) + 1);
  return new Map(
    products.map((p) => {
      const year = p.releaseDate.slice(0, 4);
      const repeated = (seen.get(p.name) ?? 0) > 1 && /^\d{4}$/.test(year);
      return [p.fileName, repeated ? `${p.name} (${year})` : p.name];
    })
  );
}

/** What the seed job needs to know about a stored precon deck. */
export interface PreconStamp {
  fileName: string;
  code: string;
  releaseDate: string;
  /** Epoch ms of the last resolve, which is when its prices were current. */
  refreshedAt: number;
}

/**
 * Builds the stored deck (the frontend's `Deck` shape, which is what
 * `user_decks.data` holds for everyone) from a resolved precon. Mirrors the
 * client's `importToDeck` (frontend/src/lib/import-to-deck.ts), which turns
 * the same product response into a starter deck: a second commander-zone
 * card is the partner, and it comes out of the 99 because the resolver also
 * lists it among the cards.
 *
 * Returns null when no commander resolved: a deck page without one would
 * misrepresent the product, so the job skips it and tries again next run.
 */
export function buildPreconDeck(
  product: ProductSummary,
  sections: Pick<DeckSections, 'commander' | 'partner' | 'cards'>,
  now: number
): Record<string, unknown> | null {
  if (!sections.commander) return null;
  const partner = sections.partner;
  const partnerAt = partner ? sections.cards.findIndex((c) => c.name === partner.name) : -1;
  const cards = sections.cards.filter((_, i) => i !== partnerAt);
  const stamp: PreconStamp = {
    fileName: product.fileName,
    code: product.code,
    releaseDate: product.releaseDate,
    refreshedAt: now,
  };
  return {
    id: preconDeckId(product.fileName),
    name: product.name,
    format: 'commander',
    source: 'manual',
    commander: sections.commander,
    partnerCommander: partner,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: cards.map((card: ScryfallCard, i) => ({
      slotId: `precon-${i}`,
      card,
      allocatedCopyId: null,
    })),
    sideboard: [],
    considering: [],
    generationContext: null,
    color: '#7a8a70',
    createdAt: releaseDateMs(product.releaseDate) ?? now,
    updatedAt: now,
    precon: stamp,
  };
}

/** The stamp on a stored precon deck, or null for anything else. */
export function readPreconStamp(data: unknown): PreconStamp | null {
  const stamp = (data as { precon?: Partial<PreconStamp> } | null)?.precon;
  if (!stamp || typeof stamp.fileName !== 'string' || typeof stamp.refreshedAt !== 'number') {
    return null;
  }
  return {
    fileName: stamp.fileName,
    code: typeof stamp.code === 'string' ? stamp.code : '',
    releaseDate: typeof stamp.releaseDate === 'string' ? stamp.releaseDate : '',
    refreshedAt: stamp.refreshedAt,
  };
}
