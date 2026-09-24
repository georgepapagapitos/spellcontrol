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
