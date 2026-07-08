/**
 * One-line human descriptions for the curated Scryfall oracle-tag (otag)
 * snapshot bundled at /tagger-tags.json (see lib/card-tags.ts for the lookup
 * machinery). Keys must track the snapshot's tag set — pinned by
 * otag-descriptions.test.ts against the actual JSON so a snapshot regen that
 * adds a tag fails loudly instead of falling back silently.
 */
export const OTAG_DESCRIPTIONS: Record<string, string> = {
  ramp: 'Accelerates your mana beyond one land per turn',
  'cost-reducer': 'Makes your spells cheaper to cast',
  'mana-dork': 'Creature that produces mana',
  'mana-rock': 'Artifact that produces mana',
  removal: 'Gets rid of an opposing card or permanent',
  'spot-removal': 'Removes a single targeted threat',
  counterspell: 'Counters a spell on the stack',
  bounce: 'Returns permanents to their owner’s hand',
  boardwipe: 'Destroys or removes many permanents at once',
  'card-advantage': 'Nets you more cards than it cost',
  draw: 'Draws you extra cards',
  tutor: 'Searches your library for a specific card',
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
 * Description for a tag key, falling back to a humanized label
 * ("some-new-tag" → "Some new tag") for keys outside the snapshot.
 */
export function describeOtag(key: string): string {
  return OTAG_DESCRIPTIONS[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, ' ');
}
