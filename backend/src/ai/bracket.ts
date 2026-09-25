import {
  estimateBracket,
  bracketLabel,
  checkRoleEvidence,
  resolveComboTemplates,
  HARDCODED_GAME_CHANGERS,
  EMPTY_ORACLE_TAGS,
  type BracketEstimation,
  type DetectedCombo,
  type TagLookup,
  type OracleTagLookup,
  type TemplateCard,
} from '@spellcontrol/deck-metrics';
import type { ScryfallCache } from '../cache';
import type { ScryfallCard } from '../types';
import { matchCombos, type ComboInput, type ComboMatch } from '../combos/match';

/**
 * Running the bracket estimator server-side, so the AI can CHECK that a swap it
 * is about to propose actually moves the bracket instead of asserting that it
 * does.
 *
 * Every input is derived here rather than taken from the client, because the
 * interesting question is a HYPOTHETICAL — "what would this deck be if I cut X
 * for Y" — and the client has no estimate for a deck that doesn't exist yet.
 * Deriving them also keeps the before/after pair internally consistent: both
 * sides are computed the same way, so the DELTA is trustworthy even where the
 * absolute number drifts from the client's.
 *
 * ⚠️ It can drift. The frontend's live `is:gamechanger` Scryfall query is
 * authoritative on a complete fetch and only falls back to (or unions with)
 * this hardcoded list when that fetch fails or breaks mid-page — so a very new
 * game changer can count there and not here, and a card the RC has REMOVED
 * from the list can count here and not there. The estimate this returns is a
 * check on a proposed change, NOT the number the UI shows — the UI's stays
 * client-side.
 */

const ORACLE_MAX_AGE_MS = Number.MAX_SAFE_INTEGER;

/** The `inDeck` bucket, in the shape the estimator wants. `deckCards` +
 *  `oracleTags` resolve any `--` template requirement against the deck's
 *  actual cards (see `resolveComboTemplates`) instead of leaving it
 *  permanently unverified. */
function toDetectedCombos(
  matched: ComboMatch[],
  deckCards: readonly TemplateCard[],
  oracleTags: OracleTagLookup
): DetectedCombo[] {
  return matched.map((m): DetectedCombo => {
    const { satisfied } = resolveComboTemplates(
      m.combo.templateQueries,
      m.combo.cards.map((c) => c.cardName),
      deckCards,
      oracleTags
    );
    return {
      comboId: m.combo.id,
      cards: m.combo.cards.map((c) => c.cardName),
      results: m.combo.produces,
      // `inDeck` is by definition the complete bucket — nothing is missing.
      isComplete: true,
      missingCards: [],
      deckCount: m.combo.popularity,
      bracket: m.combo.bracket,
      bracketTag: m.combo.bracketTag ?? null,
      cardCount: m.combo.cardCount,
      templatesSatisfied: satisfied,
    };
  });
}

export interface BracketInputs {
  cache: ScryfallCache;
  tags: TagLookup;
  /** Loads the combos touching these oracle ids — `loadRelevantCombos`. */
  loadCombos: (oracleIds: string[]) => Promise<ComboInput[]>;
  /** The deck's commander(s). Without them a commander + one-card combo reads as
   *  Bracket 3 here while the deck page, which passes them, shows Bracket 4. */
  commanderNames?: readonly string[];
  /** Scryfall oracle-tag corpus for `otag:` combo-template clauses
   *  (`otag-lookup.ts`). Defaults to "no known tags" — every `otag:` template
   *  clause then reads null (unsupported), same as an absent snapshot. */
  oracleTags?: OracleTagLookup;
}

/**
 * Estimate the bracket for an exact list of card names.
 *
 * `roleCounts` and `averageCmc` are computed from the SAME tag data and card
 * cache the estimator itself reads, rather than taken from the request. Passing
 * the client's numbers would mean the "before" estimate used one source and the
 * "after" estimate another, which is the one way to make a delta lie.
 *
 * Both mirror the deck page (`computeRoleCounts` / `analyzeCommanderDeck` in
 * `commanderDeckAnalysis.ts`), which is what this tool is trying not to drift
 * from: mainboard non-lands only, commander(s) excluded from both the role
 * counts and the CMC average, and each role gated against the card's own
 * oracle text (front face for a multi-face card) via the shared
 * `checkRoleEvidence` — the same evidence check `validateCardRole`/
 * `reportRoleOf` run on the page, so a mistagged or mismatched cache record
 * can't inflate the count here either.
 */
export async function estimateForNames(
  names: string[],
  { cache, tags, loadCombos, commanderNames, oracleTags = EMPTY_ORACLE_TAGS }: BracketInputs
): Promise<BracketEstimation> {
  const oracleIds: string[] = [];
  const deckCards: ScryfallCard[] = [];
  let cmcTotal = 0;
  let nonLandCount = 0;
  const roleCounts: Record<string, number> = {};
  const commanders = new Set(commanderNames ?? []);

  for (const name of names) {
    const card = cache.getCheapestByName(name, ORACLE_MAX_AGE_MS);
    if (!card) continue;
    deckCards.push(card);
    if (card.oracle_id) oracleIds.push(card.oracle_id);
    // The FRONT face decides: an MDFC's combined type line reads "Sorcery // Land",
    // and every frontend call site counts that card as a spell.
    const frontType = card.card_faces?.[0]?.type_line ?? card.type_line ?? '';
    if (/\bLand\b/.test(frontType)) continue;
    // The commander(s) count toward the deck for combo/game-changer purposes
    // (their oracle id already went into `oracleIds` above) but not toward the
    // average CMC or role counts — the page excludes them from both.
    if (commanders.has(name)) continue;

    cmcTotal += card.cmc ?? 0;
    nonLandCount++;

    const role = tags.getCardRole(name);
    if (!role) continue;
    const oracleText =
      (card.card_faces?.length ?? 0) >= 2
        ? (card.card_faces?.[0]?.oracle_text ?? '')
        : (card.oracle_text ?? '');
    if (checkRoleEvidence(role, oracleText)) {
      roleCounts[role] = (roleCounts[role] ?? 0) + 1;
    }
  }

  // Combos are re-matched against the hypothetical list, which is the whole
  // point: an "add" that completes a two-card combo moves the bracket through a
  // hard floor, and taking the client's combo list for the CURRENT deck would
  // miss exactly that case.
  let combos: DetectedCombo[] = [];
  try {
    const pool = await loadCombos(oracleIds);
    if (pool.length > 0) {
      const matched = matchCombos({
        combos: pool,
        deckOracleIds: oracleIds,
        ownedOracleIds: oracleIds,
        format: 'commander',
      });
      combos = toDetectedCombos(matched.inDeck, deckCards, oracleTags);
    }
  } catch {
    // A combo lookup failure must not fail the whole check; it only removes a
    // floor, and the caller reports what it computed.
    combos = [];
  }

  return estimateBracket(
    names,
    combos,
    nonLandCount > 0 ? Number((cmcTotal / nonLandCount).toFixed(2)) : 0,
    undefined,
    roleCounts,
    new Set(HARDCODED_GAME_CHANGERS),
    tags,
    commanderNames
  );
}

/** One line per hard floor, so the model can say WHY the bracket is what it is. */
function floorSummary(est: BracketEstimation): string {
  if (est.hardFloors.length === 0) return 'no hard floors';
  return est.hardFloors.map((f) => `B${f.bracket} (${f.reason})`).join(', ');
}

/**
 * Render a before/after pair as the tool result the model reads.
 *
 * Deliberately states the DELTA first and in words. The measured failure mode
 * with bracket numbers is that the model explains the scale back to the reader
 * or inverts it ("a cEDH power level (a competitive 2)"), so the result says
 * what changed rather than handing over two numbers to interpret.
 */
export function renderBracketCheck(
  before: BracketEstimation,
  after: BracketEstimation,
  change: { add?: string; cut?: string }
): string {
  const what = [
    change.add ? `adding ${change.add}` : null,
    change.cut ? `cutting ${change.cut}` : null,
  ]
    .filter(Boolean)
    .join(' and ');

  const moved =
    after.bracket === before.bracket
      ? `does NOT change the bracket — still ${before.bracket} (${bracketLabel(before.bracket)})`
      : `moves the bracket ${after.bracket > before.bracket ? 'UP' : 'DOWN'}, ${before.bracket} (${bracketLabel(before.bracket)}) -> ${after.bracket} (${bracketLabel(after.bracket)})`;

  return [
    `${what ? `${what.charAt(0).toUpperCase()}${what.slice(1)}` : 'This change'} ${moved}.`,
    `Before: bracket ${before.bracket}, floors: ${floorSummary(before)}.`,
    `After:  bracket ${after.bracket}, floors: ${floorSummary(after)}.`,
    'Bracket numbers rise with power: 1 Exhibition, 2 Core, 3 Upgraded, 4 Optimized, 5 cEDH.',
  ].join('\n');
}
