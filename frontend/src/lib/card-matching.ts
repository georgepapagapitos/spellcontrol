/**
 * Card-matching primitives (E20 Slice D — substrate unification).
 *
 * The cut/swap surfaces (`intelligent-cuts`, `card-fit`, `similar-cards`, and the
 * swap-emitting UI) each ask the same three "are these two cards alike?" questions:
 * do they share a **tagger role**, a **primary card type**, or **color identity**?
 * Those predicates were copy-pasted across files (`roleOf`, `primaryTypeOf`,
 * `colorsOverlap`, two separate `withinIdentity` legality checks). This module is
 * the single home for them so the swap engine and the fit/similarity scorers agree
 * on what "matches".
 *
 * Pure — only depends on the tagger/scryfall helpers and the card shape.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { getCardRole } from '@/deck-builder/services/tagger/client';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';

/** The card's functional tagger role — its own `deckRole` when present, else the
 *  tagger's name-based classification. `null` when unclassified. */
export const roleOf = (card: ScryfallCard): string | null =>
  card.deckRole ?? getCardRole(card.name);

/** True when two cards share the same (non-null) functional role. */
export function sameRole(a: ScryfallCard, b: ScryfallCard): boolean {
  const ra = roleOf(a);
  return !!ra && roleOf(b) === ra;
}

/** Leading card type ("Creature", "Instant", …), stripped of "Legendary" and
 *  any subtype after the em-dash. Mirrors deckAnalyzer's primaryType derivation
 *  ("Artifact Creature" → "Creature", "Legendary Creature — God" → "Creature"). */
export function primaryTypeOf(card: ScryfallCard): string {
  const words = getFrontFaceTypeLine(card)
    .split('—')[0]
    .replace(/Legendary\s+/i, '')
    .trim()
    .split(/\s+/)
    .filter((w) => w && w !== 'Basic' && w !== 'Snow');
  // Last word of the supertype run is the core type ("Artifact Creature" → "Creature").
  return words[words.length - 1] ?? '';
}

/** True when two cards resolve to the same (non-empty) primary card type. */
export function sameType(a: ScryfallCard, b: ScryfallCard): boolean {
  const ta = primaryTypeOf(a);
  return !!ta && primaryTypeOf(b) === ta;
}

/** Do two cards share at least one color identity? (Colorless shares with no one.) */
export function colorsOverlap(a: ScryfallCard, b: ScryfallCard): boolean {
  const bColors = new Set(b.color_identity ?? []);
  return (a.color_identity ?? []).some((c) => bColors.has(c));
}

/** True when `card`'s color identity is legal under `identity` (a subset of it).
 *  Colorless cards are always within identity. */
export function withinColorIdentity(card: ScryfallCard, identity: string[]): boolean {
  const allowed = new Set(identity);
  return (card.color_identity ?? []).every((c) => allowed.has(c));
}
