import { FLAVOR_NAMES } from './flavor-names.js';
import { normalizeForSearch } from './normalize-search.js';

/**
 * The name printed on a card, which is not always its oracle name. Some
 * printings carry a flavor name: the Final Fantasy "through the ages" Light Up
 * the Stage reads "A Promise Fulfilled", and Secret Lair and the Godzilla series
 * do the same. Lists sort and label by what is on the card; search matches
 * either name; exports and deck-legality keep the oracle name, because that is
 * what every other tool resolves.
 *
 * Structural so it takes every card shape the app holds: `EnrichedCard`,
 * `ListEntry`, a public share card (`setCode`/`collectorNumber`), and a
 * Scryfall card (`set`/`collector_number`, which may carry `flavor_name` itself
 * when it came from the live API).
 */
export interface PrintingNameFields {
  name: string;
  setCode?: string;
  collectorNumber?: string;
  set?: string;
  collector_number?: string;
  flavor_name?: string;
}

/** The printing's flavor name, or undefined when it prints its oracle name. */
export function flavorNameOf(card: PrintingNameFields): string | undefined {
  if (card.flavor_name) return card.flavor_name;
  const set = card.setCode ?? card.set;
  const number = card.collectorNumber ?? card.collector_number;
  if (!set || !number) return undefined;
  return FLAVOR_NAMES[`${set.toLowerCase()}:${number}`];
}

/** What the card itself reads: its flavor name when it has one, else its oracle name. */
export function printedName(card: PrintingNameFields): string {
  return flavorNameOf(card) ?? card.name ?? '';
}

/**
 * Punctuation-agnostic match of an already-normalized query (see
 * `normalizeForSearch`) against both of a card's names, so "a promise" and
 * "light up" each find the Final Fantasy printing.
 */
export function nameMatchesNormalized(card: PrintingNameFields, normalizedQuery: string): boolean {
  if (normalizeForSearch(card.name ?? '').includes(normalizedQuery)) return true;
  const flavor = flavorNameOf(card);
  return flavor !== undefined && normalizeForSearch(flavor).includes(normalizedQuery);
}

export interface FlavorPrinting {
  /** Lowercased Scryfall set code. */
  set: string;
  collectorNumber: string;
}

let printingsByFlavor: Map<string, FlavorPrinting[]> | undefined;

/**
 * Every printing that carries this flavor name, so a list typed off the card
 * ("A Promise Fulfilled") can resolve to the printing it names. Matched through
 * `normalizeForSearch`, so case and punctuation don't matter, and a double-faced
 * flavor name also answers to its front face alone.
 *
 * When `set` (and `collectorNumber`) are given, the printings that match them
 * come first. Empty when nothing carries the name.
 */
export function printingsWithFlavorName(
  name: string,
  set?: string,
  collectorNumber?: string
): FlavorPrinting[] {
  if (!printingsByFlavor) {
    printingsByFlavor = new Map();
    for (const [key, flavor] of Object.entries(FLAVOR_NAMES)) {
      const split = key.indexOf(':');
      const printing = { set: key.slice(0, split), collectorNumber: key.slice(split + 1) };
      const names = new Set([flavor, flavor.split(' // ')[0]].map(normalizeForSearch));
      for (const n of names) {
        const list = printingsByFlavor.get(n);
        if (list) list.push(printing);
        else printingsByFlavor.set(n, [printing]);
      }
    }
  }
  const found = printingsByFlavor.get(normalizeForSearch(name)) ?? [];
  const s = set?.toLowerCase();
  const rank = (p: FlavorPrinting) =>
    (p.set === s ? 0 : 2) + (p.collectorNumber === collectorNumber ? 0 : 1);
  return [...found].sort((a, b) => rank(a) - rank(b));
}
