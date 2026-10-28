import type { Customization, ScryfallCard } from '@/deck-builder/types';
import { defaultCustomization } from '@/deck-builder/store';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import { generateDeck } from '@/deck-builder/services/deckBuilder/deckGenerator';
import type { SubstituteCandidate } from '@/deck-builder/services/deckBuilder/substituteFinder';
import { deckColorIdentity } from './deck-validation';
import {
  buildAvailableCollection,
  buildBasicPrintingAvailability,
} from '@/lib/collection/collection-availability';
import type { EnrichedCard } from '@spellcontrol/binder-routing';
import type { SavedCube } from '@/store/cube';
import type { Deck } from '@/store/decks';
import type { PlanStep } from '@/lib/coach/apply-upgrade-plan';
import { deckEdits } from './regenerate-edits';

/** One land out, one land in. */
export interface LandSwap {
  out: ScryfallCard;
  in: ScryfallCard;
}

export interface LandRecheck {
  swaps: LandSwap[];
  /** EDHREC inclusion % per incoming land, where the page rates it. */
  inclusion: Record<string, number>;
  /** Lands the player added by hand since the build: they stay, and the
   *  re-check builds around them. */
  kept: string[];
  /** Swaps the player declined on an earlier re-check, left out of `swaps`. */
  hidden: LandSwap[];
}

/** One swap's identity across re-checks: the land out and the land in. */
export function landSwapKey(s: { out: { name: string }; in: { name: string } }): string {
  return `${s.out.name}>${s.in.name}`;
}

const isLand = (c: ScryfallCard) => getFrontFaceTypeLine(c).includes('Land');
const isBasic = (c: ScryfallCard) => /\bBasic\b/.test(c.type_line ?? '');

/** The deck's saved build settings over the defaults, or null when the deck
 *  has none to replay. */
function savedSettings(deck: Deck): Customization | null {
  const gc = deck.generationContext;
  if (deck.source !== 'generated' || !deck.commander || !gc) return null;
  return {
    ...defaultCustomization,
    ...gc.customization,
    collectionMode: gc.customization?.collectionMode ?? gc.collectionMode,
    landCount: gc.customization?.landCount ?? gc.landCount,
    targetBracket:
      gc.customization?.targetBracket ?? (gc.targetBracket as Customization['targetBracket']),
  };
}

/**
 * Re-check lands replays the deck's own land step against the collection as it
 * is now, so it is offered only where both halves exist: a deck built from the
 * collection, by the EDHREC pipeline (the other generators and Pauper Commander
 * build their land pool from a Scryfall query this step doesn't rebuild).
 */
export function canRecheckLands(deck: Deck): boolean {
  const s = savedSettings(deck);
  return (
    !!s &&
    s.collectionMode &&
    s.collectionStrategy !== 'exclude' &&
    (s.generationMode ?? 'edhrec') === 'edhrec' &&
    s.mtgFormat !== 'paupercommander'
  );
}

/**
 * Pair what leaves with what arrives. Same-name copies cancel out first, so
 * only real changes remain; nonbasics then pair with nonbasics and basics with
 * basics, which reads as "this land became that one" instead of a shuffle.
 * More outs than ins (the step came up short) leaves the extra outs in place.
 */
export function pairLandSwaps(current: ScryfallCard[], next: ScryfallCard[]): LandSwap[] {
  const remaining = new Map<string, number>();
  for (const c of next) remaining.set(c.name, (remaining.get(c.name) ?? 0) + 1);
  const outs: ScryfallCard[] = [];
  for (const c of current) {
    const n = remaining.get(c.name) ?? 0;
    if (n > 0) remaining.set(c.name, n - 1);
    else outs.push(c);
  }
  const used = new Map<string, number>();
  const ins: ScryfallCard[] = [];
  for (const c of next) {
    const left = remaining.get(c.name) ?? 0;
    const taken = used.get(c.name) ?? 0;
    if (taken < left) {
      ins.push(c);
      used.set(c.name, taken + 1);
    }
  }
  const nonbasicFirst = (a: ScryfallCard, b: ScryfallCard) =>
    Number(isBasic(a)) - Number(isBasic(b));
  outs.sort(nonbasicFirst);
  ins.sort(nonbasicFirst);
  return ins.slice(0, outs.length).map((card, i) => ({ out: outs[i], in: card }));
}

/** The swaps as upgrade-plan steps, for the shared apply path. */
export function landSwapSteps(swaps: LandSwap[]): PlanStep[] {
  return swaps.map((s) => ({ addName: s.in.name, cutName: s.out.name }));
}

/**
 * The deck's generated-list snapshot after the swaps, so a later Regenerate or
 * re-check reads them as the build's own picks, not as the player's edits (an
 * edit is kept fixed, and its cut land banned, which would freeze the deck at
 * this re-check forever). The swaps left unchecked are remembered as declined,
 * so the next re-check doesn't offer them again (E1034).
 */
export function generatedListAfter(
  deck: Pick<Deck, 'generationContext'>,
  applied: PlanStep[],
  declined: LandSwap[] = []
): Deck['generationContext'] {
  const gc = deck.generationContext;
  if (!gc) return gc;
  const taken = new Set(applied.map((s) => `${s.cutName}>${s.addName}`));
  const declinedLandSwaps = [
    ...new Set([...(gc.declinedLandSwaps ?? []), ...declined.map(landSwapKey)]),
  ].filter((k) => !taken.has(k));
  const withDeclines = {
    ...gc,
    declinedLandSwaps: declinedLandSwaps.length > 0 ? declinedLandSwaps : undefined,
  };
  if (!gc.generatedList) return withDeclines;
  const cards = [...gc.generatedList.cards];
  for (const step of applied) {
    if (step.cutName) {
      const at = cards.indexOf(step.cutName);
      if (at >= 0) cards.splice(at, 1);
    }
    if (!BASIC_NAMES.has(step.addName) && !cards.includes(step.addName)) cards.push(step.addName);
  }
  return { ...withDeclines, generatedList: { ...gc.generatedList, cards } };
}

const BASIC_NAMES = new Set([
  'Plains',
  'Island',
  'Swamp',
  'Mountain',
  'Forest',
  'Wastes',
  'Snow-Covered Plains',
  'Snow-Covered Island',
  'Snow-Covered Swamp',
  'Snow-Covered Mountain',
  'Snow-Covered Forest',
  'Snow-Covered Wastes',
]);

export interface RecheckEnv {
  collection: EnrichedCard[];
  decks: Deck[];
  cubes: readonly SavedCube[];
  /** The player's saved ban list. */
  bannedCards?: readonly string[];
  onProgress?: (message: string, percent: number) => void;
}

/**
 * Build the deck again with its saved settings, every spell in it pinned, and
 * the collection as it is now, then keep only the lands. The whole generator
 * runs, not just its land step: later phases reshape the mana base (the land
 * squeeze, the coherence repair, the whole-deck search), so the land step alone
 * disagrees with what the generator ships even when nothing has changed. This
 * deck's own copies count as free: they are what the re-check may keep.
 */
export async function recheckLands(deck: Deck, env: RecheckEnv): Promise<LandRecheck> {
  const s = savedSettings(deck);
  if (!s || !deck.commander || !canRecheckLands(deck)) {
    throw new Error('This deck has no build settings to re-check.');
  }
  const lands = deck.cards.filter((c) => isLand(c.card)).map((c) => c.card);
  const spells = deck.cards.filter((c) => !isLand(c.card)).map((c) => c.card);

  // Hand edits since the build: added lands stay put, cut cards stay out.
  const edits = deckEdits(deck);
  const pinned = new Set([...(s.mustIncludeCards ?? []), ...(edits?.added ?? [])]);
  const keptNames = new Set(
    lands.filter((c) => !isBasic(c) && pinned.has(c.name)).map((c) => c.name)
  );
  const open = lands.filter((c) => !keptNames.has(c.name));

  env.onProgress?.('Reading your collection', 2);
  const others = env.decks.filter((d) => d.id !== deck.id);
  const collectionBasicPrintings = buildBasicPrintingAvailability(
    env.collection,
    others,
    env.cubes
  );
  let collectionNames: Set<string>;
  let collectionAvailableCounts: Map<string, number> | undefined;
  if (s.collectionStrategy === 'available') {
    const available = buildAvailableCollection(env.collection, others, env.cubes);
    collectionNames = available.names;
    collectionAvailableCounts = available.counts;
  } else {
    collectionNames = new Set(env.collection.map((c) => c.name));
  }
  const pool = new Map<string, SubstituteCandidate>();
  for (const c of env.collection) {
    if (!collectionNames.has(c.name) || pool.has(c.name)) continue;
    pool.set(c.name, {
      name: c.name,
      colorIdentity: c.colorIdentity ?? [],
      cmc: c.cmc,
      typeLine: c.typeLine,
      scryfallId: c.scryfallId || undefined,
      oracleId: c.oracleId,
      edhrecRank: c.edhrecRank,
    });
  }

  const generated = await generateDeck({
    commander: deck.commander,
    partnerCommander: deck.partnerCommander,
    colorIdentity: [...deckColorIdentity(deck.commander, deck.partnerCommander)],
    customization: {
      ...s,
      // The deck's own land count, held: a re-check swaps lands one for one.
      landCount: lands.length,
      landsExplicit: true,
      bannedCards: [...(env.bannedCards ?? [])],
      mustIncludeCards: [],
      tempMustIncludeCards: [],
      tempBannedCards: [...(edits?.cut ?? [])],
    },
    selectedThemes: deck.generationContext?.selectedThemes ?? [],
    collectionNames,
    collectionAvailableCounts,
    collectionBasicPrintings,
    collectionPool: pool.size > 0 ? [...pool.values()] : undefined,
    optimizeDeckCards: [...new Set([...spells.map((c) => c.name), ...keptNames])],
    onProgress: env.onProgress,
  });
  if (generated.dataSource === 'scryfall') {
    throw new Error("Couldn't load land picks for this commander. Try again when you're online.");
  }

  const next = Object.values(generated.categories)
    .flat()
    .filter((c) => isLand(c) && !keptNames.has(c.name));
  const declined = new Set(deck.generationContext?.declinedLandSwaps ?? []);
  const all = pairLandSwaps(open, next);
  return {
    swaps: all.filter((s) => !declined.has(landSwapKey(s))),
    inclusion: generated.cardInclusionMap ?? {},
    kept: [...keptNames],
    hidden: all.filter((s) => declined.has(landSwapKey(s))),
  };
}
