// E554: how far past a role's cap the generator may seat a card, decided once.
//
// E532 lets a staple (STAPLE_INCLUSION_BAR% or more of the commander's decks)
// or a combo-line piece pass a role's cap, up to a second tolerance band, and
// discloses it in the role-cap overflow note. cardPicking.ts made that
// decision inline, so the deck-invariant checker (deckInvariants.ts) never
// knew about it and flagged every such card as a role over its cap. Both now
// read this leaf.
import { roleCapTolerance } from './categorize';

/** EDHREC inclusion (%) at which a card is a staple of the commander's page. */
export const STAPLE_INCLUSION_BAR = 40;

/** Tolerance bands above a role's target: 1 is the cap, 2 the staple ceiling. */
export const ROLE_CAP_BAND = 1;
export const STAPLE_CEILING_BAND = 2;

/** The count a role reaches at `bands` tolerance bands above its target. */
export function roleCapLimit(target: number, bands: number = ROLE_CAP_BAND): number {
  return target + bands * roleCapTolerance(target);
}

/** A card the cap does not hold back (until the staple ceiling): a staple or a combo-line piece. */
export function passesRoleCap(inclusion: number, isComboLinePiece: boolean): boolean {
  return inclusion >= STAPLE_INCLUSION_BAR || isComboLinePiece;
}

/**
 * Whether a role that ended at `actual` cards over a `target` is explained by
 * E532: no higher than the staple ceiling, every card past the cap one the cap
 * lets through (`passing` = seated cards of the role for which passesRoleCap
 * holds), and the overflow disclosed.
 */
export function overflowIsAdmitted(input: {
  target: number;
  actual: number;
  passing: number;
  disclosed: boolean;
}): boolean {
  const { target, actual, passing, disclosed } = input;
  if (!disclosed) return false;
  if (actual > roleCapLimit(target, STAPLE_CEILING_BAND)) return false;
  return actual - roleCapLimit(target) <= passing;
}
