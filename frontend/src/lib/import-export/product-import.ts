import type { ProductPhysicalCard, UploadResponse } from '@/types/index';
import { scryfallToEnrichedCard } from '@/lib/cards/scryfall-to-enriched';

/** Label every product import is stamped with in the collection history (T17). */
export const PRODUCT_IMPORT_LABEL = 'product-import';

const TOKEN_LAYOUTS = new Set(['token', 'double_faced_token', 'emblem']);

/** A product's token (or emblem): MTGJSON's tokens zone, or a token layout in any zone. */
export function isProductToken(pc: ProductPhysicalCard): boolean {
  return pc.zone === 'tokens' || TOKEN_LAYOUTS.has(pc.card.layout ?? '');
}

/** Copy count across a product's physical cards (basics etc. carry quantity > 1). */
export function physicalCopyCount(physicalCards: ProductPhysicalCard[]): number {
  return physicalCards.reduce((n, pc) => n + Math.max(1, pc.quantity), 0);
}

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
    fetchErrors: [],
    malformedRows: [],
    skippedUnownedRows: 0,
    clampedRows: 0,
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
  // A Secret Lair deck's bonus card, which the backend adds (product-map.ts withBonusCards).
  bonus: 'Bonus card',
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
  'bonus',
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

/** MTGJSON zones that make up the playable deck (backend `product-map.ts` DECK_ZONES). */
const DECK_ZONES = new Set(['commander', 'mainBoard']);

/** One physical copy, with the finish it ships in. */
export interface ProductCopy {
  card: ProductPhysicalCard['card'];
  finish: ProductPhysicalCard['finish'];
}

/**
 * The box's physical cards that are not part of the playable deck and not
 * tokens (display commanders, the box's sideboard, planes, schemes), one entry
 * per copy. A deck built from the product keeps these "In the box"
 * (`Deck.extras`), so every card in the box claims its copy.
 */
export function productBoxExtras(physicalCards: ProductPhysicalCard[]): ProductCopy[] {
  return physicalCards
    .filter((pc) => !DECK_ZONES.has(pc.zone) && !isProductToken(pc))
    .flatMap((pc) =>
      Array.from({ length: Math.max(1, pc.quantity) }, () => ({
        card: pc.card,
        finish: pc.finish,
      }))
    );
}

/**
 * The finish the box's command-zone copy of `cardId` ships in. A display
 * commander is often the same printing in another finish, so the command zone
 * claims its own finish and leaves the other copy for In the box.
 */
export function productCommanderFinish(
  physicalCards: ProductPhysicalCard[],
  cardId: string | undefined
): ProductPhysicalCard['finish'] | undefined {
  if (!cardId) return undefined;
  return physicalCards.find((pc) => pc.zone === 'commander' && pc.card.id === cardId)?.finish;
}
