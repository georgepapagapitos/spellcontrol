/**
 * Coach's way into the whole-deck objective (E540, "one brain"): builds the
 * objective's context from a SAVED deck, the way generation builds it from
 * its state (deckGeneration/phaseWholeDeckSearch.ts), so a move Coach shows can
 * be judged by the same score generation's search uses.
 *
 * A saved deck carries less than a fresh generation, and what it lacks is
 * rebuilt rather than guessed:
 *  - the EDHREC page it was built from is replayed from its saved settings
 *    (deckEdhrecSource.ts), the same page Coach already reads;
 *  - the build's constraints come from `generationContext.customization`, with
 *    the target bracket Coach holds the deck to (`bracketOverride` first);
 *  - ownership, combos and role targets are the page's own (Coach has them).
 *
 * When there is not enough to score honestly the answer is a named reason
 * (`CannotScore`), never a context built on a guess: no page (offline, an
 * unindexed commander), a thin page (a quality prior read off a handful of
 * rows is noise), a format without a commander, no role targets.
 *
 * Lives in lib/coach, not in deckObjective: it reads the analysis and deck
 * modules, which in turn will call the objective, and the objective must not
 * reach back up (deckObjective/layering.test.ts guards that).
 */
import type {
  CollectionStrategy,
  Customization,
  DeckDataSource,
  DetectedCombo,
  LiftEntry,
  Pacing,
  ScryfallCard,
} from '@/deck-builder/types';
import type { ComboMatch, ComboMatchResponse } from '@/types/combos';
import type { Deck } from '@/store/decks';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import {
  comboMatchesToDetected,
  countedRoleOf,
} from '@/deck-builder/services/deckBuilder/commanderDeckAnalysis';
import {
  deckEdhrecSource,
  fetchDeckEdhrecPage,
} from '@/deck-builder/services/deckBuilder/deckEdhrecSource';
import {
  createObjectiveContext,
  type EdhrecRow,
  type ObjectiveContext,
  type ObjectiveDeck,
  type ObjectiveRole,
} from '@/deck-builder/services/deckBuilder/deckObjective';
import { edhrecRowsFrom } from '@/deck-builder/services/deckBuilder/deckObjective/panelDump';
import { getByCardName } from '@/lib/cards/card-text';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { comboEndsGame } from '@/deck-builder/services/winConditions/detect';
import { coachDeckSettings } from './deck-settings-fit';
import { createCoachProtections, type CoachProtectionInputs } from './coach-protections';

/**
 * Fewest page rows (cards with a play rate) a context is built on. A page the
 * generator reads has a few hundred; the quality prior and the off-page floor
 * (context.ts) are read off these, and a few dozen rows is a partly loaded or
 * barely played commander whose floor says nothing.
 */
export const MIN_PAGE_ROWS = 40;

export type CannotScoreReason =
  /** The deck's format has no commander (Coach and the analysis are commander-only). */
  | 'not-commander'
  /** A commander format deck with no commander chosen yet. */
  | 'no-commander'
  /** EDHREC could not be reached or has no page for this commander. */
  | 'no-page'
  /** The page has fewer than MIN_PAGE_ROWS rows. */
  | 'thin-page'
  /** The analysis has not produced role targets (the roles term would read nothing). */
  | 'no-role-targets';

export interface CannotScore {
  ok: false;
  reason: CannotScoreReason;
}

export interface CoachObjective {
  ok: true;
  ctx: ObjectiveContext;
  /** The command zone and the mainboard, one entry per copy. */
  deck: ObjectiveDeck;
  /** Rows on the page the context reads. */
  pageRows: number;
}

export type CoachObjectiveResult = CoachObjective | CannotScore;

type SavedDeck = Pick<
  Deck,
  'format' | 'commander' | 'partnerCommander' | 'cards' | 'generationContext' | 'bracketOverride'
> & { buildReport?: { collectionStrategy?: CollectionStrategy; dataSource?: DeckDataSource } };

export interface CoachObjectiveInput {
  deck: SavedDeck;
  /** The page's rows (inclusion, synergy, sample): `edhrecRowsFrom(page)`. */
  rows: ReadonlyMap<string, EdhrecRow>;
  /** The analysis' role targets (`analysis.roleTargets`). */
  roleTargets: Partial<Record<string, number>> | undefined;
  /** The commander's combo set: complete and near-miss (`coachCombos`). */
  combos?: readonly DetectedCombo[];
  /** The collection's names. Used only when the deck was built from the collection. */
  ownedNames?: ReadonlySet<string>;
  /**
   * Names with a FREE copy (not claimed by another deck or a cube). Under the
   * "available" strategy these, not every owned name, are what the deck may use.
   */
  availableNames?: ReadonlySet<string>;
  gameChangerNames?: ReadonlySet<string>;
  /**
   * What Coach's cut paths read besides the deck itself, for the one
   * protection set (coach-protections.ts): the cards the win paths name as the
   * deck's alt win, the analysis' missing staples, and the cards Coach already
   * flags as weak. Omitted: the set is read off the deck and the page alone.
   */
  protections?: Pick<CoachProtectionInputs, 'altWinNames' | 'gaps' | 'flagged'>;
  /** Cards whose Scryfall `edhrec_rank` feeds the off-page read (the deck's, the candidates'). */
  knownCards?: readonly ScryfallCard[];
  /** Not saved with a deck: omitted reads the objective's default. */
  pacing?: Pacing;
  liftPools?: ReadonlyMap<string, readonly LiftEntry[]>;
  manaSim?: { games?: number; seed?: number };
}

/**
 * What the one protection set reads off a deck's analysis (the persisted one on
 * the deck page, the harness's fresh one): the win paths' alt-win cards, the
 * missing staples, and the cards Coach already flags as weak.
 */
export function protectionSourcesFrom(a: {
  winConditions?: {
    primary?: { category?: string; evidence: readonly string[] } | null;
    secondary?: readonly { category?: string; evidence: readonly string[] }[];
  } | null;
  gapAnalysis?: readonly { name: string; inclusion: number }[];
  misfits?: readonly { name: string }[];
  optimizeSwaps?: { removals?: readonly { name: string }[] } | null;
}): NonNullable<CoachObjectiveInput['protections']> {
  const wins = [a.winConditions?.primary, ...(a.winConditions?.secondary ?? [])];
  return {
    altWinNames: new Set(
      wins.filter((w) => w?.category === 'alt-win').flatMap((w) => [...w!.evidence])
    ),
    gaps: a.gapAnalysis,
    flagged: new Set(
      [...(a.misfits ?? []), ...(a.optimizeSwaps?.removals ?? [])].map((m) => m.name.toLowerCase())
    ),
  };
}

/**
 * The customization the objective holds a saved deck to: what it was built
 * with, the target bracket Coach holds it to, and its format's size and pool
 * (a Brawl list is 59 cards: fill-deck.ts fillFormatSettings sets the same).
 */
export function coachCustomization(deck: SavedDeck): Partial<Customization> {
  const gc = deck.generationContext;
  const c: Partial<Customization> = { ...(gc?.customization ?? {}) };
  const settings = coachDeckSettings(deck);
  const config = DECK_FORMAT_CONFIGS[deck.format];
  const builtFor = c.targetBracket ?? gc?.targetBracket;
  const collectionMode = c.collectionMode ?? gc?.collectionMode ?? false;
  return {
    ...c,
    mtgFormat: config.hasCommander ? deck.format : 'commander',
    ...(config.mainboardSize === 99 ? {} : { deckFormat: config.deckSize }),
    targetBracket: (deck.bracketOverride ?? builtFor ?? 'all') as Customization['targetBracket'],
    collectionMode,
    // The strategy Coach holds the deck to (the build report's when the settings don't say).
    ...(settings?.collectionStrategy ? { collectionStrategy: settings.collectionStrategy } : {}),
    currency: c.currency ?? 'USD',
  };
}

/**
 * The objective's context and deck for a saved deck, or why it can't be
 * scored. Pure: the page and everything else come in.
 */
export function buildCoachObjective(input: CoachObjectiveInput): CoachObjectiveResult {
  const { deck } = input;
  if (!DECK_FORMAT_CONFIGS[deck.format].hasCommander) return { ok: false, reason: 'not-commander' };
  if (!deck.commander) return { ok: false, reason: 'no-commander' };
  const pageRows = [...input.rows.values()].filter((r) => r.inclusion > 0).length;
  if (input.rows.size === 0) return { ok: false, reason: 'no-page' };
  if (pageRows < MIN_PAGE_ROWS) return { ok: false, reason: 'thin-page' };
  const targets = input.roleTargets;
  if (!targets || Object.keys(targets).length === 0)
    return { ok: false, reason: 'no-role-targets' };

  const commanders = [deck.commander, deck.partnerCommander].filter(
    (c): c is ScryfallCard => c != null
  );
  const cards = deck.cards.map((c) => c.card);
  const customization = coachCustomization(deck);
  // The generator reads each page card's global rank off the cards it fetched.
  const globalRank = new Map<string, number>();
  for (const c of [...cards, ...(input.knownCards ?? [])]) {
    if (c.edhrec_rank && getByCardName(input.rows, c.name)) globalRank.set(c.name, c.edhrec_rank);
  }
  const owned =
    customization.collectionMode &&
    customization.collectionStrategy === 'available' &&
    input.availableNames
      ? input.availableNames
      : input.ownedNames;
  const colorIdentity = [...new Set(commanders.flatMap((c) => c.color_identity ?? []))];
  // The one protection set Coach's cut paths read: judgeMove refuses the same cuts.
  const protection = createCoachProtections({
    commanders,
    invested: analyzeDeckSynergy(cards).invested,
    inclusionOf: (name) => getByCardName(input.rows, name)?.inclusion,
    gameChangerNames: input.gameChangerNames,
    ...input.protections,
  });
  const ctx = createObjectiveContext({
    extraProtections: protection,
    colorIdentity,
    customization,
    edhrec: input.rows,
    roleTargets: targets as Partial<Record<ObjectiveRole, number>>,
    roleOf: countedRoleOf,
    pacing: input.pacing,
    combos: input.combos ? [...input.combos] : [],
    liftPools: input.liftPools,
    globalRank,
    ownedNames: customization.collectionMode && owned ? new Set(owned) : undefined,
    gameChangerNames: input.gameChangerNames,
    manaSim: input.manaSim,
  });
  return { ok: true, ctx, deck: { commanders, cards }, pageRows };
}

/** A one-away match as the objective's near-miss combo (no template counts until the deck meets it). */
function nearMiss(m: ComboMatch): DetectedCombo {
  const missing = new Set(m.missingOracleIds);
  return {
    comboId: m.combo.id,
    cards: m.combo.cards.map((c) => c.cardName),
    results: m.combo.produces,
    isComplete: false,
    missingCards: m.combo.cards.filter((c) => missing.has(c.oracleId)).map((c) => c.cardName),
    deckCount: m.combo.popularity,
    bracket: m.combo.bracket,
    bracketTag: m.combo.bracketTag ?? null,
    cardCount: m.combo.cardCount,
  };
}

/**
 * The commander's combo set from the combos panel's answer: the lines the deck
 * holds (templates resolved against its cards) and the lines one card away,
 * which are what an add can complete. A line one card away counts only when the
 * loop ends the game (`comboEndsGame`, E437): the rule the combos lane and the
 * Next best move share, so an add that would only make mana or draw cards is
 * never credited as a combo.
 */
export function coachCombos(
  resp: ComboMatchResponse | null | undefined,
  deckCards: readonly ScryfallCard[]
): DetectedCombo[] {
  if (!resp) return [];
  return [
    ...comboMatchesToDetected(resp, deckCards),
    ...resp.oneAway.filter((m) => comboEndsGame(m.combo.produces)).map(nearMiss),
  ];
}

export interface CoachObjectiveEnv extends Omit<CoachObjectiveInput, 'deck' | 'rows'> {
  /** Replaces the page fetch (tests, a page already in hand). */
  fetchPage?: typeof fetchDeckEdhrecPage;
}

/**
 * The saved deck's page (the one it was built from, falling back to the
 * commander's base page) and then its objective. A failed fetch is `no-page`,
 * never an exception: Coach keeps its own ranking when the objective can't run.
 */
export async function loadCoachObjective(
  deck: SavedDeck,
  env: CoachObjectiveEnv
): Promise<CoachObjectiveResult> {
  if (!DECK_FORMAT_CONFIGS[deck.format].hasCommander) return { ok: false, reason: 'not-commander' };
  if (!deck.commander) return { ok: false, reason: 'no-commander' };
  const { fetchPage = fetchDeckEdhrecPage, ...rest } = env;
  let rows: Map<string, EdhrecRow>;
  try {
    const page = await fetchPage(deck.commander, deck.partnerCommander, deckEdhrecSource(deck));
    rows = edhrecRowsFrom(page);
  } catch {
    return { ok: false, reason: 'no-page' };
  }
  return buildCoachObjective({ ...rest, deck, rows });
}
