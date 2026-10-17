/**
 * What a land does for the deck's plan, beyond its mana (E1030).
 *
 * The land passes judge a land as a mana source: its colors, its tempo, its
 * popularity. A land that taps for {C} and destroys a land is then the worst
 * land in a mono-red deck, and the coherence repair traded Tectonic Edge and
 * Volatile Fault for Cori Mountain Monastery, Great Furnace and Lindblum (two
 * of them taplands there) in a Zo-Zu land-destruction build, because red read
 * six sources short. The land was doing the deck's job.
 *
 * A job pairs what a land does with what the deck's spells do. A land serves
 * the plan when one of its jobs is a job the deck is built around:
 *  - land removal: the land destroys a land, and the deck runs four or more
 *    spells that destroy, exile or force the sacrifice of lands, or turn
 *    nonbasics into basics (Blood Moon);
 *  - artifacts: an artifact land, in a deck invested in artifacts;
 *  - tokens: a land that makes creature tokens, in a token deck;
 *  - sacrifice: a land that sacrifices creatures, in a sacrifice deck.
 * The last three read the deck's own synergy axes (deckSynergy.ts); land
 * removal has no axis, so the deck's spells are read here.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { analyzeDeckSynergy } from '../synergy/deckSynergy';
import type { AxisKey } from '../synergy/axes';

export type LandPlanJob = 'land-removal' | 'artifacts' | 'tokens' | 'sacrifice';

/** Spells that attack lands before land removal reads as the deck's plan. */
export const LAND_REMOVAL_PLAN_MIN = 4;

/** The deck's jobs a land may serve. */
export type DeckLandPlan = ReadonlySet<LandPlanJob>;

interface Face {
  type: string;
  text: string;
}

/** Each face's type line and rules text, reminder text dropped, lower-cased. */
function facesOf(card: ScryfallCard): Face[] {
  const faces = card.card_faces?.length
    ? card.card_faces
    : [{ type_line: card.type_line, oracle_text: card.oracle_text }];
  return faces.map((f) => ({
    type: (f.type_line ?? '').toLowerCase(),
    text: (f.oracle_text ?? '').replace(/\([^)]*\)/g, '').toLowerCase(),
  }));
}

const isLandFace = (f: Face) => /\bland\b/.test(f.type);

/** A land destroys a land, or makes a player sacrifice one. */
const DESTROYS_LAND = [
  /\bdestroy (?:target|up to \w+|x target|that)\b[^.\n]{0,30}?\blands?\b/,
  /\btarget player sacrifices a land\b/,
];

/** Spell text that attacks lands (Cleansing Wildfire, Jokulhaups, Tremble, Blood
 *  Moon), but not a wipe that spares them ("except artifacts and lands"). */
const ATTACKS_LANDS = [
  /\bdestroy (?:target|up to \w+|x target|that|all|each)\b(?:(?!except)[^.\n]){0,40}?\blands?\b/,
  /\b(?:player|opponent)s? sacrifices? [^.\n]{0,40}?\blands?\b/,
  /\bexile target (?:nonbasic )?land\b/,
  /\bnonbasic lands are\b/,
];

const SACRIFICES_CREATURES =
  /\bsacrifice (?:a|an|another|one|two|three|four|five|x) [^.:\n]{0,20}?creatures?\b/;

/** The jobs a card's land faces do besides making mana. */
export function landPlanJobs(card: ScryfallCard): LandPlanJob[] {
  const lands = facesOf(card).filter(isLandFace);
  const text = lands.map((f) => f.text).join('\n');
  const jobs: LandPlanJob[] = [];
  if (DESTROYS_LAND.some((re) => re.test(text))) jobs.push('land-removal');
  if (lands.some((f) => f.type.includes('artifact'))) jobs.push('artifacts');
  if (/\bcreate [^.\n]*\bcreature tokens?\b/.test(text)) jobs.push('tokens');
  if (SACRIFICES_CREATURES.test(text)) jobs.push('sacrifice');
  return jobs;
}

/** Whether a card's spell faces attack lands. */
export function attacksLands(card: ScryfallCard): boolean {
  const text = facesOf(card)
    .filter((f) => !isLandFace(f))
    .map((f) => f.text)
    .join('\n');
  return ATTACKS_LANDS.some((re) => re.test(text));
}

const AXIS_JOBS: [LandPlanJob, AxisKey][] = [
  ['artifacts', 'artifacts'],
  ['tokens', 'tokens'],
  ['sacrifice', 'sacrifice'],
];

/** The jobs this deck is built around, read from its nonland cards and commanders. */
export function readDeckLandPlan(
  nonLandCards: readonly ScryfallCard[],
  commanders: readonly ScryfallCard[] = []
): DeckLandPlan {
  const plan = new Set<LandPlanJob>();
  const spells = [...commanders, ...nonLandCards];
  if (spells.filter(attacksLands).length >= LAND_REMOVAL_PLAN_MIN) plan.add('land-removal');
  const invested = new Set(analyzeDeckSynergy(spells).invested);
  for (const [job, axis] of AXIS_JOBS) if (invested.has(axis)) plan.add(job);
  return plan;
}

/** The deck job this land serves, if any. */
export function planJobServed(card: ScryfallCard, plan: DeckLandPlan): LandPlanJob | undefined {
  if (plan.size === 0) return undefined;
  return landPlanJobs(card).find((j) => plan.has(j));
}
