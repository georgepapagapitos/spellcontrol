import type { ScryfallCard } from '@/deck-builder/types';
import { isManaSourceType } from './mana-sources';

/** "Add {G}" and "adds an additional {G}" (Wild Growth) both count. */
const ADDS = /\badds?\b/i;

/**
 * Whether a card could plausibly make mana, judged from what a stored deck row
 * actually carries.
 *
 * This exists to keep the lookup proportionate. Every card in a pre-#2011 deck
 * is missing `produced_mana`, so asking for all of them would make this a
 * whole-deck fetch; asking only for the plausible producers halves it. Measured
 * on five live public decks: ~35 names instead of ~70, and it missed none of
 * the cards whose production actually changed once resolved.
 */
function couldMakeMana(card: ScryfallCard): boolean {
  if (!isManaSourceType(card)) return false;
  if ((card.type_line ?? '').toLowerCase().includes('land')) return true;
  const text = card.oracle_text;
  // ABSENT text is unknown text: a double-faced card keeps its rules on the
  // faces and carries none at the top level (Cryptolith Fragment), so ask
  // rather than assume it makes no mana. An EMPTY string is different — that
  // is a vanilla card telling us it has no rules text at all, and asking on
  // its behalf is what turns this back into a whole-deck fetch.
  if (text == null) return true;
  return ADDS.test(text);
}

/**
 * Names of the plausible mana sources whose STORED copy carries no
 * `produced_mana`.
 *
 * A deck keeps each card as the Scryfall cache had it the day the card was
 * added, and the cache only started keeping `produced_mana` in #2011. So a deck
 * built before that holds no production data at all, and the mana analysis
 * falls back to reading oracle text — which never reads `{C}`. On a colorless
 * deck that is the difference between 49 mana sources and zero.
 *
 * Sorted and de-duplicated so the caller can use it as a memo key.
 */
export function namesMissingProducedMana(cards: readonly ScryfallCard[]): string[] {
  const out = new Set<string>();
  for (const card of cards) {
    if (card?.name && card.produced_mana === undefined && couldMakeMana(card)) out.add(card.name);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** The `produced_mana` among freshly resolved cards, keyed by the name asked
 *  for. A card that resolved without it contributes nothing. */
export function producedManaFrom(
  resolved: ReadonlyMap<string, ScryfallCard>
): ReadonlyMap<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [name, card] of resolved) {
    if (card.produced_mana) out.set(name, card.produced_mana);
  }
  return out;
}

/**
 * Stamp resolved production onto the cards that lack it.
 *
 * Returns the SAME array when nothing changes, so a caller can keep it in a
 * `useMemo` dependency without re-running the analysis on every render.
 */
export function applyProducedMana(
  cards: readonly ScryfallCard[],
  production: ReadonlyMap<string, string[]>
): readonly ScryfallCard[] {
  if (production.size === 0) return cards;
  let changed = false;
  const next = cards.map((card) => {
    if (!card || card.produced_mana !== undefined) return card;
    const produced = production.get(card.name);
    if (!produced) return card;
    changed = true;
    return { ...card, produced_mana: produced };
  });
  return changed ? next : cards;
}
