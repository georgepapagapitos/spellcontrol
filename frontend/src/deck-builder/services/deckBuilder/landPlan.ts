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
 *  - artifacts: an artifact land, in a deck invested in artifacts (the deck's
 *    own synergy axis, deckSynergy.ts).
 * Token makers and sacrifice outlets are left out on purpose: read the same way
 * in the E1030 ship gate, they took Krenko's Nykthos and Three Tree City and The
 * Ur-Dragon's shocklands for Kher Keep and The Lonely Mountain. A token deck's
 * page already rates the token lands worth playing.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { analyzeDeckSynergy } from '../synergy/deckSynergy';

export type LandPlanJob = 'land-removal' | 'artifacts';

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

/** The jobs a card's land faces do besides making mana. */
export function landPlanJobs(card: ScryfallCard): LandPlanJob[] {
  const lands = facesOf(card).filter(isLandFace);
  const text = lands.map((f) => f.text).join('\n');
  const jobs: LandPlanJob[] = [];
  if (DESTROYS_LAND.some((re) => re.test(text))) jobs.push('land-removal');
  if (lands.some((f) => f.type.includes('artifact'))) jobs.push('artifacts');
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

/** The jobs this deck is built around, read from its nonland cards and commanders. */
export function readDeckLandPlan(
  nonLandCards: readonly ScryfallCard[],
  commanders: readonly ScryfallCard[] = []
): DeckLandPlan {
  const plan = new Set<LandPlanJob>();
  const spells = [...commanders, ...nonLandCards];
  if (spells.filter(attacksLands).length >= LAND_REMOVAL_PLAN_MIN) plan.add('land-removal');
  if (analyzeDeckSynergy(spells).invested.includes('artifacts')) plan.add('artifacts');
  return plan;
}

/** The deck job this land serves, if any. */
export function planJobServed(card: ScryfallCard, plan: DeckLandPlan): LandPlanJob | undefined {
  if (plan.size === 0) return undefined;
  return landPlanJobs(card).find((j) => plan.has(j));
}
