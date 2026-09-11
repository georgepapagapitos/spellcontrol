// The play format a cube is built for. It decides which owned cards are even
// eligible, and which corpus the targets come from (see ./targets).
//
// `limited` (the default at every size): the cube drafts into 40-card decks,
// two players a game. A card whose rules text needs a commander or the command
// zone — Command Tower, Arcane Signet, Commander's Sphere, Path of Ancestry —
// does nothing there, and a group-hug card (Secret Rendezvous) hands its only
// opponent three cards. Both are left out at pool time and counted in the pool
// note (board E288: EDHREC rank put four such blanks into a 180-card cube).
//
// `commander`: a multiplayer Commander cube. Nothing is excluded, and the
// targets come from the corpus of popular CubeCobra Commander cubes.
//
// Eligibility reads Scryfall's oracle tags (the bundled otag index, see
// lib/card-tags): `commander-matters` is Scryfall's own curated "cares about
// commander mechanics" set and `synergy-commander` its wider sibling; together
// they cover every blank in the dev collection that an oracle-text regex finds,
// without the regex's false positives (Partner reminder text, Lieutenant
// bodies, a card's own name — "Wintermoor Commander"). One predicate, injected
// with a `tagsOf` lookup so it stays pure and testable.

export type CubeFormat = 'limited' | 'commander';
export const CUBE_FORMATS: readonly CubeFormat[] = ['limited', 'commander'];

export const FORMAT_INFO: Record<CubeFormat, { label: string; sub: string; note: string }> = {
  limited: {
    label: 'Draft',
    sub: '40-card decks',
    note: 'Drafts into 40-card decks. Cards that need a commander or the command zone are left out.',
  },
  commander: {
    label: 'Commander',
    sub: 'multiplayer',
    note: 'A multiplayer Commander cube. Command-zone cards stay in, shaped like popular Commander cubes.',
  },
};

/** Why a card is ineligible for the format, or null when it may go in. */
export type FormatExclusion = 'commanderOnly' | 'politics';

const COMMANDER_ONLY_TAGS = ['commander-matters', 'synergy-commander'];
const POLITICS_TAGS = ['group-hug'];

export function formatExclusion(
  format: CubeFormat,
  tags: readonly string[]
): FormatExclusion | null {
  if (format !== 'limited' || tags.length === 0) return null;
  if (COMMANDER_ONLY_TAGS.some((t) => tags.includes(t))) return 'commanderOnly';
  if (POLITICS_TAGS.some((t) => tags.includes(t))) return 'politics';
  return null;
}
