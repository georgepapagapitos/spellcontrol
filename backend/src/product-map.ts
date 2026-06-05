import type { ImportRow } from './parsers/types';

/**
 * Maps an MTGJSON preconstructed-deck file into the `ImportRow[]` shapes the
 * import/resolve pipeline already understands (T17).
 *
 * MTGJSON splits a product's cards across several zones. The split matters:
 *   - `commander` (1) + `mainBoard` (99) = the **playable 100-card deck**.
 *   - `displayCommander` (foil-etched / alt-art commander copies — e.g. the
 *     "Raining Cats and Dogs" precon ships 3), `tokens`, `planes`, `schemes`,
 *     and `sideBoard` are **extra physical cards** that come in the box but are
 *     NOT part of the playable singleton deck.
 *
 * So "add as a deck" uses {@link productToDeckSections} (playable 100 only),
 * while "add to collection" wants every physical card — the deck zones PLUS
 * {@link productToExtraRows}. Each card carries `identifiers.scryfallId`, which
 * resolves to the exact printing (and correct foil) via the priority-1 id path.
 */

/** A single card entry inside an MTGJSON deck zone. */
export interface MtgjsonDeckCard {
  count?: number;
  name: string;
  setCode?: string;
  /** Collector number within the set. */
  number?: string;
  isFoil?: boolean;
  identifiers?: { scryfallId?: string };
}

/** The `data` object of an MTGJSON `decks/<fileName>.json` file. */
export interface MtgjsonDeckFile {
  name: string;
  code: string;
  type: string;
  releaseDate?: string;
  commander?: MtgjsonDeckCard[];
  mainBoard?: MtgjsonDeckCard[];
  sideBoard?: MtgjsonDeckCard[];
  displayCommander?: MtgjsonDeckCard[];
  tokens?: MtgjsonDeckCard[];
  planes?: MtgjsonDeckCard[];
  schemes?: MtgjsonDeckCard[];
}

export interface ProductDeckSections {
  commanderRows: ImportRow[];
  companionRows: ImportRow[];
  deckRows: ImportRow[];
}

/**
 * The two zones that make up the playable singleton deck. Every OTHER
 * card-bearing zone is treated as a physical extra (see {@link productToExtraRows}).
 */
export const DECK_ZONES = ['commander', 'mainBoard'] as const;

/**
 * True when a value is an MTGJSON card entry (an object with a string `name`).
 * Lets us discover extra-card zones structurally rather than by a hardcoded
 * list, so a product's bonus cards can't be silently dropped just because they
 * live in a zone we didn't anticipate. (Metadata arrays like `sealedProductUuids`
 * and `sourceSetCodes` are arrays of strings, so they fail this and are skipped.)
 */
function isCardEntry(value: unknown): value is MtgjsonDeckCard {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string'
  );
}

function cardToRow(card: MtgjsonDeckCard, section: string): ImportRow {
  return {
    name: card.name,
    quantity: Math.max(1, card.count ?? 1),
    setCode: card.setCode,
    collectorNumber: card.number,
    // MTGJSON deck cards only carry a boolean isFoil (no etched flag), so map to
    // foil/nonfoil; the exact printing still comes from scryfallId.
    finish: card.isFoil ? 'foil' : 'nonfoil',
    scryfallId: card.identifiers?.scryfallId,
    sourceFormat: 'mtgjson',
    section,
    // Tag the originating zone so the collection-add side can label extras.
    sourceCategory: section,
  };
}

/**
 * The playable singleton deck: commander zone → commander slot, mainBoard → the
 * 99. MTGJSON precons have no companion zone, so companionRows is always empty
 * (the field is kept so the result plugs straight into `resolveDeckRows`).
 */
export function productToDeckSections(deck: MtgjsonDeckFile): ProductDeckSections {
  return {
    commanderRows: (deck.commander ?? []).map((c) => cardToRow(c, 'commander')),
    companionRows: [],
    deckRows: (deck.mainBoard ?? []).map((c) => cardToRow(c, 'deck')),
  };
}

/**
 * Every extra physical card in the box — display/etched commanders, sideboard,
 * tokens, planes, schemes, and any OTHER card-bearing zone MTGJSON exposes — but
 * NOT the playable 100. Discovered structurally (any array of card entries that
 * isn't a deck zone) so an unanticipated bonus-card zone can't be silently
 * dropped. Used by the collection-add path to stamp the box's true contents
 * (e.g. 100 + an etched commander). Zones are walked in sorted order for
 * deterministic output.
 */
export function productToExtraRows(deck: MtgjsonDeckFile): ImportRow[] {
  const rows: ImportRow[] = [];
  for (const [zone, value] of extraZoneEntries(deck)) {
    for (const card of value) {
      rows.push(cardToRow(card, zone));
    }
  }
  return rows;
}

/**
 * Every physical card in the box across EVERY card-bearing zone (deck cards +
 * display commanders + tokens + …), each tagged with its zone. Used by the
 * collection-add path, which wants the complete finish-accurate contents rather
 * than just the playable 100.
 */
export function productToPhysicalRows(deck: MtgjsonDeckFile): ImportRow[] {
  const rows: ImportRow[] = [];
  for (const card of deck.commander ?? []) rows.push(cardToRow(card, 'commander'));
  for (const card of deck.mainBoard ?? []) rows.push(cardToRow(card, 'mainBoard'));
  rows.push(...productToExtraRows(deck));
  return rows;
}

/** Total physical card count across every card-bearing zone (playable + extras). */
export function countPhysicalCards(deck: MtgjsonDeckFile): number {
  let total = 0;
  for (const card of deck.commander ?? []) total += Math.max(1, card.count ?? 1);
  for (const card of deck.mainBoard ?? []) total += Math.max(1, card.count ?? 1);
  for (const [, value] of extraZoneEntries(deck)) {
    for (const card of value) total += Math.max(1, card.count ?? 1);
  }
  return total;
}

/**
 * All non-deck zones that contain card entries, as [zoneName, cards] pairs in
 * sorted zone order. Treats the deck object as an open record so zones MTGJSON
 * may add in the future are still discovered.
 */
function extraZoneEntries(deck: MtgjsonDeckFile): [string, MtgjsonDeckCard[]][] {
  const out: [string, MtgjsonDeckCard[]][] = [];
  for (const [zone, value] of Object.entries(deck as unknown as Record<string, unknown>)) {
    if ((DECK_ZONES as readonly string[]).includes(zone)) continue;
    if (!Array.isArray(value)) continue;
    const cards = value.filter(isCardEntry);
    if (cards.length > 0) out.push([zone, cards]);
  }
  out.sort((a, b) => a[0].localeCompare(b[0]));
  return out;
}
