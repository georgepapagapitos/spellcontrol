import type { ProductPhysicalCard, UploadResponse } from '../types';
import { scryfallToEnrichedCard } from './scryfall-to-enriched';

/** Label every product import is stamped with in the collection history (T17). */
export const PRODUCT_IMPORT_LABEL = 'product-import';

/**
 * Expands a product's full physical card list into an {@link UploadResponse}
 * ready for `collection.importCards` — one owned copy per physical card, with
 * the correct finish (foil/etched) preserved per copy. Used by the product
 * "Add to collection" path so a precon stamps its true contents (the 100 plus
 * display/etched commanders and tokens), not just the playable deck.
 */
export function physicalCardsToUploadResponse(
  physicalCards: ProductPhysicalCard[]
): UploadResponse {
  const cards = physicalCards.flatMap((pc) =>
    Array.from({ length: Math.max(1, pc.quantity) }, () =>
      scryfallToEnrichedCard(pc.card, pc.finish)
    )
  );
  return {
    cards,
    totalRows: cards.length,
    scryfallHits: cards.length,
    scryfallMisses: 0,
    unresolvedNames: [],
    detectedFormat: 'mtgjson',
  };
}

/** Groups a product's physical cards by zone, in display order, with copy counts. */
export interface ZoneBreakdown {
  zone: string;
  label: string;
  count: number;
}

const ZONE_LABELS: Record<string, string> = {
  commander: 'Commander',
  mainBoard: 'Deck',
  displayCommander: 'Display commander',
  sideBoard: 'Sideboard',
  tokens: 'Tokens',
  planes: 'Planes',
  schemes: 'Schemes',
};

/** Display order for zones — the playable deck first, then physical extras. */
const ZONE_ORDER = [
  'commander',
  'mainBoard',
  'displayCommander',
  'sideBoard',
  'tokens',
  'planes',
  'schemes',
];

/** Human label for an MTGJSON zone (falls back to the raw zone name). */
export function zoneLabel(zone: string): string {
  return ZONE_LABELS[zone] ?? zone;
}

/** Zones present in `physicalCards`, in display order (known zones first). */
function orderedZones(physicalCards: ProductPhysicalCard[]): string[] {
  const present = new Set(physicalCards.map((pc) => pc.zone));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const zone of [...ZONE_ORDER, ...present]) {
    if (present.has(zone) && !seen.has(zone)) {
      seen.add(zone);
      out.push(zone);
    }
  }
  return out;
}

/**
 * Per-zone copy counts for a product's physical cards, deck zones first. Powers
 * the "100 deck + 3 display commanders + 2 tokens" breakdown so the user can
 * reconcile against the physical box.
 */
export function zoneBreakdown(physicalCards: ProductPhysicalCard[]): ZoneBreakdown[] {
  const counts = new Map<string, number>();
  for (const pc of physicalCards) {
    counts.set(pc.zone, (counts.get(pc.zone) ?? 0) + Math.max(1, pc.quantity));
  }
  return orderedZones(physicalCards).map((zone) => ({
    zone,
    label: zoneLabel(zone),
    count: counts.get(zone)!,
  }));
}

/** A product's physical cards grouped by zone, in display order, with counts. */
export interface ProductZoneGroup {
  zone: string;
  label: string;
  count: number;
  cards: ProductPhysicalCard[];
}

/**
 * Groups a product's physical cards by zone for the inline card grid — deck
 * first, then display commanders / tokens / etc. Card order within a zone is
 * preserved. `count` is the copy total (basics etc. carry quantity > 1).
 */
export function groupPhysicalByZone(physicalCards: ProductPhysicalCard[]): ProductZoneGroup[] {
  const byZone = new Map<string, ProductPhysicalCard[]>();
  for (const pc of physicalCards) {
    const list = byZone.get(pc.zone) ?? [];
    list.push(pc);
    byZone.set(pc.zone, list);
  }
  return orderedZones(physicalCards).map((zone) => {
    const cards = byZone.get(zone)!;
    return {
      zone,
      label: zoneLabel(zone),
      count: cards.reduce((n, pc) => n + Math.max(1, pc.quantity), 0),
      cards,
    };
  });
}
