/**
 * One-line human descriptions for the oracle tags we care most about.
 *
 * These were written for the original 23-tag curated snapshot. The corpus is now
 * the full ~4.5k-tag Scryfall vocabulary (see lib/card-tags.ts), which is far too
 * large to hand-write copy for and only carries its own description for ~29% of
 * tags. So the resolution order in {@link describeOtag} is: our curated copy →
 * Scryfall's description → a humanized slug. These entries stay because they read
 * better than Scryfall's for the concepts users hit most; they are a preferred
 * override, no longer an exhaustive set.
 */
import { cardTagDescription } from './card-tags';

export const OTAG_DESCRIPTIONS: Record<string, string> = {
  ramp: 'Accelerates your mana beyond one land per turn',
  'cost-reducer': 'Makes your spells cheaper to cast',
  'mana-dork': 'Creature that produces mana',
  'mana-rock': 'Artifact that produces mana',
  removal: 'Gets rid of an opposing card or permanent',
  'spot-removal': 'Removes a single targeted threat',
  counterspell: 'Counters a spell on the stack',
  bounce: "Returns permanents to their owner's hand",
  boardwipe: 'Destroys or removes many permanents at once',
  'card-advantage': 'Nets you more cards than it cost',
  draw: 'Draws you extra cards',
  tutor: 'Searches your library for a specific card',
  'land-tutor': 'Searches your library for lands only',
  cantrip: 'Cheap effect that replaces itself by drawing a card',
  wheel: 'Discards hands and refills them with fresh cards',
  lifegain: 'Gains you life',
  sacrifice: 'Sacrifices permanents as a cost or for value',
  'graveyard-hate': 'Exiles or shuts off graveyards',
  protection: 'Shields your creatures, spells, or self from harm',
  'mana-fix': 'Helps you produce the right colors of mana',
  'utility-land': 'Land with an ability beyond making mana',
  tapland: 'Land that enters the battlefield tapped',
  'mass-land-denial': 'Destroys or locks down many lands at once',
  'extra-turn': 'Grants an additional turn',
};

/**
 * Description for a tag key: our curated copy first, then Scryfall's own
 * description from the corpus, else '' — callers render nothing. There is
 * deliberately no third fallback: ~70% of the corpus carries no description,
 * and a title-cased slug is the row's LABEL, so 30 of the 120 top rows on
 * /tags read "Triggered ability · 17,138 cards · Triggered ability"
 * (playtest batch 10).
 */
export function describeOtag(key: string): string {
  return OTAG_DESCRIPTIONS[key] || cardTagDescription(key) || '';
}
