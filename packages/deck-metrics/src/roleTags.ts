// The tag folds for the ramp and removal roles, decided from tags alone. One
// definition, read by the frontend tagger client (every role count, badge and
// generator phase) and by `createTagLookup` (the backend's `check_bracket`), so
// the report, the generator and the bracket estimate never disagree about what
// a card is.

/** Tags that fold into the `ramp` role. */
const RAMP_ROLE_TAGS = ['ramp', 'cost-reducer', 'mana-dork', 'mana-rock'];

/** Tags that make a ramp card a ramp piece in its own right. */
const RAMP_SPECIFIC_TAGS = ['mana-dork', 'mana-rock', 'cost-reducer', 'land-tutor'];

/**
 * Tags naming a different main job for the card. `bounce` is deliberately not
 * one: every bounce spell that interacts (Unsummon, Snap, Cyclonic Rift) also
 * carries `removal`, so a card tagged `bounce` without it is returning its own
 * permanent, and on a ramp card that is part of the ramp (Mana Bloom returns
 * itself, Mina and Denn returns a land for an extra land drop).
 */
const OTHER_JOB_TAGS = ['counterspell', 'protection', 'removal', 'spot-removal', 'boardwipe'];

/**
 * Scryfall's generic `ramp` tag is broad. Mana Drain (it adds mana a turn
 * later) and Sword of Feast and Famine (it untaps your lands) both carry it,
 * and so do ~180 other cards whose real job is something else. A card whose
 * only ramp evidence is that generic tag, and whose tags name another job,
 * makes mana on the side: it is not a ramp piece, and counting it as one fills
 * ramp slots with counterspells and equipment while interaction reads low.
 *
 * Known cost: a few real mana cards carry a removal or protection tag for a
 * side effect (Tinder Wall, Trace of Abundance, Song of Freyalise) and lose
 * the ramp role with the rest.
 */
export function isIncidentalRampByTags(has: (tag: string) => boolean): boolean {
  return has('ramp') && !RAMP_SPECIFIC_TAGS.some(has) && OTHER_JOB_TAGS.some(has);
}

/** Does a card with these tags fill the `ramp` role? */
export function isRampByTags(has: (tag: string) => boolean): boolean {
  return RAMP_ROLE_TAGS.some(has) && !isIncidentalRampByTags(has);
}

/**
 * Does a card with these tags fill the `removal` role? A counterspell is
 * removal aimed at the stack: `getRemovalSubtype` already names it as one, and
 * a blue deck's counters are its interaction. Before E486 only the `removal`
 * tag folded in, so 489 of 546 counterspells, `Counterspell` itself included,
 * had no role at all.
 */
export function isRemovalByTags(has: (tag: string) => boolean): boolean {
  return has('removal') || has('counterspell');
}
