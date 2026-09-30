/**
 * Whether a card's counted role is incidental to what the card is (T171
 * round 3).
 *
 * Coach's role cuts treat a card as a slot of its counted role: a surplus
 * ramp card is an "Excess Ramp" cut, and a stronger ramp card replaces the
 * weakest one. That is right for a Signet. It is wrong for Battle Angels of
 * Tyr, counted as ramp for the Treasure its myriad copies make, and for
 * Drakuseth, Maw of Flames, counted as removal for its attack trigger: in an
 * Isshin deck both are the commander's payoffs, and Isshin doubles them.
 * Cutting them as excess took the deck's plan cards and left its rocks.
 *
 * A role is incidental when either:
 *  - the card facts rank it below the card's primary role (Battle Angels
 *    draws first, ramps second), or
 *  - the card feeds one of the commander's own abilities (an attack trigger
 *    Isshin multiplies, a tribe Lathril leads, an ETB a blink commander
 *    repeats): the commander profile's detectors, read off oracle text.
 * No card is named here.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { getCardFacts, type FactRole } from '@/deck-builder/services/cardFacts';
import { whyCardMatches, type CommanderProfile } from './commanderProfile';

/** The card-facts roles each counted role reads (the tagger's vocabulary). */
const FACT_ROLES: Record<string, readonly FactRole[]> = {
  ramp: ['ramp'],
  cardDraw: ['cardDraw'],
  removal: ['removal', 'counterspell'],
  boardwipe: ['boardwipe'],
};

/** The facts rank the role below another primary role on the card. */
function factsSecondary(card: ScryfallCard, role: string): boolean {
  const roles = getCardFacts(card)?.roles;
  const wanted = FACT_ROLES[role];
  if (!roles || !wanted) return false;
  const own = roles.filter((r) => wanted.includes(r.role));
  if (own.length === 0 || own.some((r) => r.tier === 'primary')) return false;
  return roles.some((r) => r.tier === 'primary' && !wanted.includes(r.role));
}

export function roleIsIncidental(
  card: ScryfallCard,
  role: string | null | undefined,
  profile: CommanderProfile | null | undefined
): boolean {
  if (!role) return false;
  if (factsSecondary(card, role)) return true;
  return !!profile && whyCardMatches(card, profile).length > 0;
}
