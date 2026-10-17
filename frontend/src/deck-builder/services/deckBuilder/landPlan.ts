/**
 * What a land does for the deck's plan, beyond its mana (E1030, E1033).
 *
 * The land passes judge a land as a mana source: its colors, its tempo, its
 * popularity. A land that taps for {C} and destroys a land is then the worst
 * land in a mono-red deck, and the coherence repair traded Tectonic Edge and
 * Volatile Fault for Cori Mountain Monastery, Great Furnace and Lindblum (two
 * of them taplands there) in a Zo-Zu land-destruction build, because red read
 * six sources short. The land was doing the deck's job. The same holds for
 * every deck that does something with its lands.
 *
 * A job pairs what a land does with what the deck's spells do. A land serves
 * the plan when one of its jobs is a job the deck is built around:
 *  - more lands: the land fetches, puts out or bounces lands, in a deck with
 *    three or more landfall payoffs (the landfall axis, deckSynergy.ts) or
 *    three or more spells that count your lands;
 *  - land recursion: the land sacrifices or cycles itself, in a deck with two
 *    or more spells that play or return lands from the graveyard;
 *  - land removal: the land destroys a land, and the deck runs four or more
 *    spells that destroy, exile or force the sacrifice of lands, or turn
 *    nonbasics into basics (Blood Moon);
 *  - land types: a Gate, Desert, Cave, Locus, Sphere or Town, in a deck with
 *    two or more spells that name that type;
 *  - creature lands: the land becomes a creature, in a deck with two or more
 *    spells that animate or reward land creatures;
 *  - artifacts: an artifact land, in a deck invested in artifacts.
 * The commander alone carries a job it names (Titania, Omnath): it is the plan.
 *
 * Token makers and sacrifice outlets are left out on purpose: read the same way
 * in the E1030 ship gate, they took Krenko's Nykthos and Three Tree City and The
 * Ur-Dragon's shocklands for Kher Keep and The Lonely Mountain. A token deck's
 * page already rates the token lands worth playing.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { analyzeDeckSynergy } from '../synergy/deckSynergy';

/** Nonbasic land types a deck can build around. */
export const PLAN_LAND_TYPES = ['gate', 'desert', 'cave', 'locus', 'sphere', 'town'] as const;
type PlanLandType = (typeof PLAN_LAND_TYPES)[number];

export type LandPlanJob =
  | 'more-lands'
  | 'land-recursion'
  | 'land-removal'
  | 'creature-lands'
  | 'artifacts'
  | `land-type:${PlanLandType}`;

/** Spells that attack lands before land removal reads as the deck's plan. */
export const LAND_REMOVAL_PLAN_MIN = 4;
/** Landfall payoffs, or spells that count lands, before more lands read as the plan. */
export const MORE_LANDS_PLAN_MIN = 3;
/** Spells for the narrower jobs: recursion, a land type, creature lands. */
export const NARROW_PLAN_MIN = 2;

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

/** The card's own names, written "~" in its text so a name never reads as a rule. */
function withoutOwnName(card: ScryfallCard, text: string): string {
  const names = [card.name, ...(card.card_faces ?? []).map((f) => f.name)];
  return names.reduce((t, n) => (n ? t.split(n.toLowerCase()).join('~') : t), text);
}

const spellText = (card: ScryfallCard) =>
  withoutOwnName(
    card,
    facesOf(card)
      .filter((f) => !isLandFace(f))
      .map((f) => f.text)
      .join('\n')
  );

/** A land destroys a land, or makes a player sacrifice one. */
const DESTROYS_LAND = [
  /\bdestroy (?:target|up to \w+|x target|that)\b[^.\n]{0,30}?\blands?\b/,
  /\btarget player sacrifices a land\b/,
];

/** A land fetches, puts out or bounces a land: each one is a land drop or a landfall trigger. */
const MAKES_LAND_DROPS = [
  /\bsearch your library for [^.\n]*\b(?:land|plains|island|swamp|mountain|forest)\b[^.\n]*\bcards?\b/,
  /\bput [^.\n]*\bland cards? [^.\n]*onto the battlefield\b/,
  /\breturn a land you control to its owner's hand\b/,
];

/** A land that sends itself to the graveyard, where recursion plays it again. */
const BINS_ITSELF = [/\bsacrifice ~/, /\bcycling\b/];

const BECOMES_CREATURE = /\bbecomes? an? [^.\n]*\bcreature\b/;

/** Spell text that attacks lands (Cleansing Wildfire, Jokulhaups, Tremble, Blood
 *  Moon), but not a wipe that spares them ("except artifacts and lands"). */
const ATTACKS_LANDS = [
  /\bdestroy (?:target|up to \w+|x target|that|all|each)\b(?:(?!except)[^.\n]){0,40}?\blands?\b/,
  /\b(?:player|opponent)s? sacrifices? [^.\n]{0,40}?\blands?\b/,
  /\bexile target (?:nonbasic )?land\b/,
  /\bnonbasic lands are\b/,
];

/** Spell text that counts your lands (Craterhoof's cousins, Multani, Ulvenwald Hydra). */
const COUNTS_LANDS = /\b(?:for each land you control|number of lands you control)\b/;

/** Spell text that plays or returns lands from the graveyard (Crucible, Ramunap, Titania, Loam). */
const RECURS_LANDS = [
  /\bplay (?:a |an )?lands? from your graveyard\b/,
  /\b(?:return|put) [^.\n]{0,30}\bland cards? from your graveyard\b/,
  /\bland cards? (?:are|is) put into your graveyard\b/,
];

/** Spell text that animates or rewards land creatures (Nissa, Koth, Sylvan Awakening). */
const ANIMATES_LANDS = [
  /\b(?:target )?lands? (?:you control )?(?:becomes?|are) [^.\n]*\bcreatures?\b/,
  /\bland creatures?\b/,
];

const ofText = (res: RegExp[], text: string) => res.some((re) => re.test(text));

/** The jobs a card's land faces do besides making mana. */
export function landPlanJobs(card: ScryfallCard): LandPlanJob[] {
  const lands = facesOf(card).filter(isLandFace);
  if (lands.length === 0) return [];
  const text = withoutOwnName(card, lands.map((f) => f.text).join('\n')).replace(
    /\bthis land\b/g,
    '~'
  );
  const types = lands.map((f) => f.type).join(' ');
  const jobs: LandPlanJob[] = [];
  if (ofText(MAKES_LAND_DROPS, text)) jobs.push('more-lands');
  if (ofText(BINS_ITSELF, text)) jobs.push('land-recursion');
  if (ofText(DESTROYS_LAND, text)) jobs.push('land-removal');
  if (BECOMES_CREATURE.test(text)) jobs.push('creature-lands');
  if (types.includes('artifact')) jobs.push('artifacts');
  // A land of the type, or one that works with it (Maze's End fetches Gates).
  for (const t of PLAN_LAND_TYPES) {
    if (new RegExp(`\\b${t}\\b`).test(types) || new RegExp(`\\b${t}s?\\b`).test(text)) {
      jobs.push(`land-type:${t}`);
    }
  }
  return jobs;
}

/** Whether a card's spell faces attack lands. */
export function attacksLands(card: ScryfallCard): boolean {
  return ofText(ATTACKS_LANDS, spellText(card));
}

/** The jobs this deck is built around, read from its nonland cards and commanders. */
export function readDeckLandPlan(
  nonLandCards: readonly ScryfallCard[],
  commanders: readonly ScryfallCard[] = []
): DeckLandPlan {
  const plan = new Set<LandPlanJob>();
  const spells = [...commanders, ...nonLandCards];
  const texts = spells.map(spellText);
  const commanderTexts = commanders.map(spellText);
  /** Cards matching, with a commander that matches counting as the whole plan. */
  const reaches = (test: (t: string) => boolean, min: number) =>
    commanderTexts.some(test) || texts.filter(test).length >= min;

  const synergy = analyzeDeckSynergy(spells);
  const landfall = synergy.axes.find((a) => a.axis === 'landfall');
  const commanderNames = new Set(commanders.map((c) => c.name));
  if (
    (landfall?.payoffs.length ?? 0) >= MORE_LANDS_PLAN_MIN ||
    landfall?.payoffs.some((p) => commanderNames.has(p.name)) ||
    reaches((t) => COUNTS_LANDS.test(t), MORE_LANDS_PLAN_MIN)
  ) {
    plan.add('more-lands');
  }
  if (reaches((t) => ofText(RECURS_LANDS, t), NARROW_PLAN_MIN)) plan.add('land-recursion');
  if (spells.filter(attacksLands).length >= LAND_REMOVAL_PLAN_MIN) plan.add('land-removal');
  if (reaches((t) => ofText(ANIMATES_LANDS, t), NARROW_PLAN_MIN)) plan.add('creature-lands');
  if (synergy.invested.includes('artifacts')) plan.add('artifacts');
  for (const t of PLAN_LAND_TYPES) {
    const names = new RegExp(`\\b${t}s?\\b`);
    if (reaches((s) => names.test(s), NARROW_PLAN_MIN)) plan.add(`land-type:${t}`);
  }
  return plan;
}

/** The deck job this land serves, if any. */
export function planJobServed(card: ScryfallCard, plan: DeckLandPlan): LandPlanJob | undefined {
  if (plan.size === 0) return undefined;
  return landPlanJobs(card).find((j) => plan.has(j));
}
