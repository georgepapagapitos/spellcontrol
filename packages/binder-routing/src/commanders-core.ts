import type { EnrichedCard } from './types.js';

/** The command-zone rule sets the app builds. Brawl adds planeswalkers. */
export type CommanderTypeFormat = 'commander' | 'brawl';

/**
 * The type half of commander eligibility, the ONE definition every caller
 * reads (the binder `commanderEligible` rule, the deck builder's
 * `isValidCommander` and its generator gate `commanderEligibility.ts`, the
 * cube legend picker and the offline `is:commander` search). CR 903.3: the
 * commander is a legendary card that is
 *   (a) a creature card,
 *   (b) a Vehicle card, or
 *   (c) a Spacecraft card with a power/toughness box;
 * or a card whose text says it "can be your commander" (903.3a).
 *
 * - The FRONT face decides (the text before " // "): Westvale Abbey // Ormendahl
 *   is a land, not a commander, though its back face is a legendary creature.
 * - Grist, the Hunger Tide counts: "As long as Grist isn't on the battlefield,
 *   it's a 1/1 Insect creature", so it is a creature card in the command zone.
 * - A Spacecraft prints its power/toughness box only when it becomes a
 *   creature, and Station's reminder text says so ("It's an artifact creature
 *   at 7+."), so the text answers it where a caller has no `power` field.
 * - Brawl also takes any legendary planeswalker.
 *
 * Case-insensitive on both inputs (the binder path stores oracle text
 * lowercased).
 */
export function canBeCommanderByType(
  typeLine: string,
  oracleText: string,
  opts: { format?: CommanderTypeFormat; power?: string | null } = {}
): boolean {
  const text = oracleText.toLowerCase();
  if (text.includes('can be your commander')) return true;
  const front = (typeLine.split('//')[0] ?? '').toLowerCase();
  if (!/\blegendary\b/.test(front)) return false;
  if (/\bcreature\b/.test(front) || /\bvehicle\b/.test(front)) return true;
  if (/\bspacecraft\b/.test(front)) {
    return opts.power != null || /\bit's an artifact creature at \d+\+/.test(text);
  }
  if (/isn't on the battlefield, it's an? [^.\n]*\bcreature\b/.test(text)) return true;
  return opts.format === 'brawl' && /\bplaneswalker\b/.test(front);
}

/**
 * Shape-agnostic commander-eligibility core: the type rule above AND
 * legal/restricted in the Commander format. The deck-builder's
 * `isValidCommander(ScryfallCard)` lives in the frontend (it depends on a
 * deck-builder-only type) and delegates here.
 */
export function isCommanderEligibleFrom(
  typeLine: string,
  oracleText: string,
  commanderLegality: string | undefined,
  opts: { power?: string | null } = {}
): boolean {
  if (!canBeCommanderByType(typeLine, oracleText, opts)) return false;
  return commanderLegality === 'legal' || commanderLegality === 'restricted';
}

/**
 * Binder-path commander-eligibility check over an EnrichedCard. `typeLine` /
 * `oracleText` already join multi-face cards (per their type docs);
 * `oracleText` is stored lowercased but the core lowercases defensively.
 * Missing fields → not eligible.
 */
export function isCommanderEligible(card: EnrichedCard): boolean {
  return isCommanderEligibleFrom(
    card.typeLine ?? '',
    card.oracleText ?? '',
    card.legalities?.commander
  );
}
