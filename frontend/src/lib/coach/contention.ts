/**
 * Contention (E1038 4.2): "owned" used to ignore that the only copy of a card
 * sits in another of the player's decks. A replacement Coach offers from the
 * collection is free only if some copy is not claimed; otherwise taking it
 * strips the deck it is in. This names that deck and, when the card holds a
 * counted role there (ramp, removal, board wipes, card advantage), says if
 * taking it drops the deck below that role's target.
 *
 * Pure: the holders come from `committedElsewhere` (lib/deck/held-elsewhere.ts)
 * over the live allocation map, the role counts from the same
 * `computeRoleCounts` the deck page shows.
 */
import type { Deck } from '@/store/decks';
import type { Holder } from '@/lib/deck/held-elsewhere';
import {
  computeRoleCounts,
  countedRoleOf,
} from '@/deck-builder/services/deckBuilder/commanderDeckAnalysis';
import { ROLE_LABELS } from '@/deck-builder/services/deckBuilder/deckAnalyzer';

export interface Hold {
  deckId: string;
  deckName: string;
  /** The counted role the card fills in that deck, when it fills one. */
  role: string | null;
  /** How many of that role the deck would keep without this card. */
  left: number;
  target: number | null;
  /** Taking the card leaves the deck under its target for the role. */
  short: boolean;
}

/** The decks holding every copy of `name`, each with what losing it does there. */
export function holdsOf(
  name: string,
  holders: readonly Holder[] | undefined,
  decks: readonly Deck[]
): Hold[] {
  if (!holders?.length) return [];
  const key = name.toLowerCase();
  const out: Hold[] = [];
  for (const h of holders) {
    const deck = decks.find((d) => d.id === h.deckId);
    const slot = deck?.cards.find((c) => c.card.name.toLowerCase() === key);
    const role = slot ? countedRoleOf(slot.card) : null;
    const target = role ? (deck?.roleTargets?.[role] ?? null) : null;
    const left =
      role && deck
        ? (computeRoleCounts(deck.cards.map((c) => c.card)).roleCounts[role] ?? 0) - 1
        : 0;
    out.push({
      deckId: h.deckId,
      deckName: h.deckName,
      role: role ?? null,
      left,
      target,
      short: role !== null && target !== null && left < target,
    });
  }
  return out;
}

const roleWords = (role: string) => (ROLE_LABELS[role] ?? role).toLowerCase();

/** One plain line for a row: which deck holds the card and what taking it costs there. */
export function contentionNote(holds: readonly Hold[]): string | undefined {
  if (holds.length === 0) return undefined;
  const names = holds.map((h) => h.deckName);
  const where =
    names.length === 1
      ? `In your ${names[0]} deck.`
      : `In your ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} decks.`;
  const hurt = holds.find((h) => h.short && h.role);
  if (!hurt) return `${where} Taking it leaves a slot to refill there.`;
  const who = holds.length === 1 ? 'that deck' : hurt.deckName;
  const lack =
    hurt.left <= 0
      ? `without any ${roleWords(hurt.role!)}`
      : `short on ${roleWords(hurt.role!)} (${hurt.left} of ${hurt.target})`;
  return `${where} Taking it leaves ${who} ${lack}.`;
}
