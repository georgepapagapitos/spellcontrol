/**
 * What the deck is for, read from the settings it was built with (E1038 3.2).
 *
 * Coach used to treat every deck as a deck to optimize: a theme deck got
 * "swap this card for the staple" rows and a cEDH-leaning deck got the same
 * feed as a precon. Players called an AI-tuned deck "miserable to play
 * against" (research 05 §3), so Coach now follows the intent the deck already
 * states, with no new setting:
 *
 *  - the Staples to Synergy dial (`customization.brewLevel`), and
 *  - the target bracket (`bracketOverride`, else the one it was built for).
 *
 * `casual` (Timmy, Johnny, Vorthos): synergy-leaning dial or Bracket 1-2. Coach
 * stops trading an on-theme card for a generic staple and leads with on-theme
 * moves. The gap, role and mana moves stay on: a deck still needs its ramp.
 * `spike`: Bracket 4-5 without a synergy-leaning dial. Speed and interaction
 * moves lead each tier.
 * `balanced`: anything else, including a deck that states nothing. Unchanged.
 *
 * The dial wins over the bracket when they disagree: someone who dragged the
 * dial to Synergy on a Bracket 4 deck wants a brew that is tuned, not a pile of
 * staples. Inference is conservative on purpose: a hand-built deck with no
 * stated bracket reads `balanced`.
 */
import type { TargetBracket } from '@/deck-builder/types';
import { COMMANDER_STAPLE_INCLUSION } from '@/deck-builder/services/deckBuilder/premiumCards';
import { isFastMana, isTutor } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import type { Change } from './deck-change';

export type DeckIntent = 'casual' | 'balanced' | 'spike';

/** The dial at or above this leans synergy (Leaning synergy, Synergy). */
const SYNERGY_DIAL = 0.75;
/** The dial at or below this leans staples (Staples, Leaning staples). */
const STAPLES_DIAL = 0.25;

/** The intent a deck states: its dial and its target bracket. */
export function deckIntent(
  brewLevel: number | undefined,
  target: TargetBracket | 'all'
): DeckIntent {
  const dial = brewLevel ?? 0.5;
  if (dial >= SYNERGY_DIAL) return 'casual';
  if (typeof target === 'number') {
    if (target >= 4) return 'spike';
    if (target <= 2 && dial > STAPLES_DIAL) return 'casual';
  }
  return 'balanced';
}

/** EDHREC synergy (a fraction) below which a card is not specific to this commander. */
const GENERIC_SYNERGY = 0.1;

/**
 * A card every deck in these colors plays, not one this deck was built around:
 * played in at least 40% of this commander's decks yet no more than a tenth
 * above the average rate (synergy), and not a card the row names as theme or an
 * engine axis. The shared-staple rocks are generic by definition.
 */
export function isGenericStaple(change: Change): boolean {
  if (change.isThemeSynergy || change.axis) return false;
  if ((change.synergy ?? 0) >= GENERIC_SYNERGY) return false;
  return (change.inclusion ?? 0) >= COMMANDER_STAPLE_INCLUSION;
}

/** A card the deck was built around: marked theme, or played here more than elsewhere. */
export function isOnTheme(card: {
  isThemeSynergyCard?: boolean;
  isThemeSynergy?: boolean;
  synergy?: number;
}): boolean {
  return (
    card.isThemeSynergyCard === true ||
    card.isThemeSynergy === true ||
    (card.synergy ?? 0) >= GENERIC_SYNERGY
  );
}

/** Interaction a Spike deck checks first: spot removal, wipes. */
export function isInteractionMove(change: Change): boolean {
  return change.role === 'removal' || change.role === 'boardwipe';
}

/** Speed a Spike deck checks first: cheap ramp, fast mana, real tutors. */
export function isSpeedMove(change: Change): boolean {
  if (isFastMana(change.name) || isTutor(change.name)) return true;
  return change.role === 'ramp' && change.cmc !== undefined && change.cmc <= 2;
}
