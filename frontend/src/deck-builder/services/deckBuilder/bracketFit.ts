/**
 * Bracket Fit — the pure, deterministic coaching engine behind the POWER tab's
 * Bracket panel.
 *
 * When a user picks a TARGET bracket (Deck.bracketOverride) that differs from
 * the deck's estimated bracket, this module produces a concrete plan of card
 * MOVES to close the gap:
 *
 *   - too-strong (estimated > target) → CUT moves (each with an optional
 *     same-role lower-bracket REPLACEMENT, emitted as a 'swap').
 *   - too-weak  (estimated < target)  → ADD moves (power the deck up).
 *   - aligned   (estimated === target)→ no moves; a small confirmation.
 *
 * It is explainable rather than guesswork because the bracket estimator already
 * exposes EXACTLY which named cards trigger each signal (game changers, mass
 * land denial, stax, extra turns, fast mana, tutors, combos). The downshift
 * planner uses a VERIFY LOOP: it re-runs the real {@link estimateBracket} with
 * the proposed cuts removed and keeps cutting only until the bracket actually
 * drops to the target — producing the MINIMAL achieving set, never over-cutting.
 *
 * This module is PURE and synchronous. The target-bracket EDHREC card pool
 * (used for replacements and adds) and the oneAway combos are passed in as
 * ARGUMENTS — nothing is fetched here. The UI layer adapts each
 * {@link BracketFitMove} into a `Change` for the shared <DeckCardRow>.
 */
import type {
  EDHRECCard,
  EDHRECCommanderData,
  DetectedCombo,
  GapAnalysisCard,
} from '@/deck-builder/types';
import type { ComboMatch } from '@/types/combos';
import { estimateBracket, isStaxPiece, type BracketEstimation } from './bracketEstimator';
import { getCardRole, isMassLandDenial, isExtraTurn } from '@/deck-builder/services/tagger/client';

// ── Types ──────────────────────────────────────────────────────────────────

export type BracketFitDirection = 'aligned' | 'too-strong' | 'too-weak';

/** The signal category that triggered (or motivated) a move. */
export type BracketFitSignal =
  | 'game-changer'
  | 'mass-land-denial'
  | 'stax'
  | 'combo'
  | 'extra-turn'
  | 'fast-mana'
  | 'tutor'
  | 'upshift-gc'
  | 'upshift-combo'
  | 'upshift-fill';

/** Display labels for the tagger functional roles (mirrors gapAnalysisBuilder). */
const ROLE_LABELS: Record<string, string> = {
  ramp: 'Ramp',
  removal: 'Removal',
  boardwipe: 'Board Wipes',
  cardDraw: 'Card Advantage',
};

/**
 * A single proposed move, shaped so the UI can convert it 1:1 into a `Change`:
 *   - type 'cut'  → cut `name` (no replacement found / not applicable).
 *   - type 'swap' → cut `name`, add `inName` (same-role, lower-power).
 *   - type 'add'  → add `name`.
 */
export interface BracketFitMove {
  type: 'add' | 'cut' | 'swap';
  /** Card to cut (cut/swap) or add (add). */
  name: string;
  /** Replacement to add (swap only). */
  inName?: string;
  /** Bracket-grounded explanation of why this move helps reach the target. */
  reason: string;
  /** The signal category that triggered this move. */
  signal: BracketFitSignal;
  /** Functional role of the relevant card (cut card for cut/swap, add card for add). */
  role?: string;
  /** Display label for `role`. */
  roleLabel?: string;
  /** EDHREC inclusion% — for the replacement (swap) or the added card (add). */
  inclusion?: number;
  /** EDHREC synergy — for the replacement (swap) or the added card (add). */
  synergy?: number;
  /** True when the cut card (cut/swap) is a Game Changer. */
  isGameChanger?: boolean;
  /** Mana value of the replacement/added card when known. */
  cmc?: number;
  /** Type line of the replacement/added card when known. */
  typeLine?: string;
  /** Image of the replacement/added card when known. */
  imageUrl?: string;
}

export interface BracketFitPlan {
  direction: BracketFitDirection;
  targetBracket: 1 | 2 | 3 | 4 | 5;
  detectedBracket: number;
  moves: BracketFitMove[];
  /** Short human summary of the plan (e.g. "Cut 2 cards to reach Bracket 2"). */
  summary: string;
  /** True when the target is reachable with the produced moves. */
  achievable: boolean;
  /** Extra note: unreachable explanation, aligned confirmation, or B5-ceiling info. */
  note?: string;
  /** True when the EDHREC pool was unavailable (offline) → replacements/adds limited. */
  offlineDegraded?: boolean;
}

/** Inputs shared by both directions and the top-level entry point. */
export interface BracketFitInput {
  /** The deck's current estimation (from estimateBracket). */
  estimation: BracketEstimation;
  /** Game Changer name set (as passed to estimateBracket). */
  gameChangerNames: Set<string>;
  /** All mainboard card names (excluding commanders). */
  allCardNames: string[];
  /** Complete in-deck combos (from comboMatchesToDetected). */
  detectedCombos: DetectedCombo[];
  /** Average CMC (as passed to estimateBracket). */
  averageCmc: number;
  /**
   * Per-card mana value + land flag for every mainboard card name. Lets the
   * verify loop recompute the deck's non-land average CMC after cuts (cutting a
   * 0-cmc fast-mana rock raises the real average, lowering the soft curve bonus),
   * instead of re-estimating with the stale pre-cut average. Absent → the loop
   * falls back to the original `averageCmc`.
   */
  cardCmcMap?: Record<string, { cmc: number; isLand: boolean }>;
  /** Role counts (as passed to estimateBracket). */
  roleCounts: Record<string, number> | undefined;
  /** Target-bracket EDHREC pool for replacements & adds. null = offline degraded. */
  targetPool: EDHRECCommanderData | null;
  /** EDHREC inclusion per in-deck card (name → %). Picks lowest-inclusion GC to cut first. */
  cardInclusionMap: Record<string, number>;
  /** One-away combos — highest-priority adds when powering up. */
  oneAwayCombos: ComboMatch[];
  /** Gap-analysis cards (top EDHREC adds not in deck) — soft upshift adds. */
  gapAnalysis: GapAnalysisCard[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function roleLabelFor(role: string | null | undefined): string | undefined {
  if (!role) return undefined;
  return ROLE_LABELS[role];
}

/**
 * Game Changer allowance per bracket:
 *   B1/B2 → 0, B3 → 3, B4/B5 → unlimited.
 */
function gameChangerAllowance(target: number): number {
  if (target <= 2) return 0;
  if (target === 3) return 3;
  return Number.POSITIVE_INFINITY;
}

/**
 * Re-run the real estimator over a candidate card list, with the proposed cuts
 * applied. A combo is dropped from the detected list once any of its pieces has
 * been cut — the estimator keys combo floors off the detected-combo list, not
 * the card list, so the verify loop must break combos explicitly to see the
 * floor fall.
 */
function reestimate(
  cardNames: string[],
  cutSet: Set<string>,
  input: Pick<
    BracketFitInput,
    'detectedCombos' | 'averageCmc' | 'roleCounts' | 'gameChangerNames' | 'cardCmcMap'
  >
): BracketEstimation {
  const liveCombos =
    cutSet.size === 0
      ? input.detectedCombos
      : input.detectedCombos.filter((c) => !c.cards.some((piece) => cutSet.has(piece)));
  return estimateBracket(
    cardNames,
    liveCombos,
    recomputeAverageCmc(cardNames, input.cardCmcMap, input.averageCmc),
    undefined,
    input.roleCounts,
    input.gameChangerNames
  );
}

/**
 * Recompute the non-land average CMC over the surviving card list, so the verify
 * loop scores the deck as it'll actually be after the cuts. Without this, cutting
 * 0-cmc fast mana would leave the stale (lower) average in place, inflating the
 * soft curve bonus and causing the loop to over-cut. Falls back to the original
 * average when no per-card map is available (e.g. offline / unit tests).
 */
function recomputeAverageCmc(
  cardNames: string[],
  cardCmcMap: Record<string, { cmc: number; isLand: boolean }> | undefined,
  fallback: number
): number {
  if (!cardCmcMap) return fallback;
  let sum = 0;
  let count = 0;
  for (const name of cardNames) {
    const entry = cardCmcMap[name];
    if (!entry || entry.isLand) continue;
    sum += entry.cmc;
    count++;
  }
  return count > 0 ? sum / count : fallback;
}

/** Cards in the deck for fast membership tests, plus DFC front faces. */
function deckNameSet(allCardNames: string[]): Set<string> {
  const set = new Set<string>();
  for (const name of allCardNames) {
    set.add(name);
    if (name.includes(' // ')) set.add(name.split(' // ')[0]);
  }
  return set;
}

/**
 * Map a combo to the in-deck card names it uses. DetectedCombo carries card
 * names directly; ComboMatch carries oracle ids + a card list with names.
 */
function comboCardNames(combo: DetectedCombo): string[] {
  return combo.cards;
}

/** Combos that floor at bracket >= 4 (the "early" combos). */
function isEarlyCombo(combo: DetectedCombo): boolean {
  const b = parseInt(combo.bracket, 10);
  return !isNaN(b) && b >= 4;
}

// ── Replacement matching ──────────────────────────────────────────────────────

/**
 * Find a same-role/type replacement for a cut card from the target-bracket
 * EDHREC pool. Excludes cards already in the deck, Game Changers, mass-land-
 * denial, extra-turn, and stax cards (they'd re-trigger a floor — a stax
 * replacement for a stax cut would leave the bracket unchanged). Highest
 * inclusion wins. Returns null when no suitable card exists (offline, no role
 * match).
 *
 * Ownership preference is applied by the caller (the engine is ownership-blind);
 * the returned card carries `isOwned` from the pool build only if present.
 */
export function findReplacement(
  cutName: string,
  targetPool: EDHRECCommanderData | null,
  deckNames: Set<string>,
  gameChangerNames: Set<string>
): GapAnalysisCard | null {
  if (!targetPool) return null;

  const cutRole = getCardRole(cutName);
  const candidates = targetPool.cardlists?.allNonLand ?? [];

  const matches: EDHRECCard[] = [];
  for (const card of candidates) {
    if (deckNames.has(card.name)) continue;
    if (gameChangerNames.has(card.name) || card.isGameChanger) continue;
    if (isMassLandDenial(card.name)) continue;
    if (isExtraTurn(card.name)) continue;
    if (isStaxPiece(card.name)) continue;
    // Same functional role (when the cut card has one). When the cut card has
    // no tagger role, fall back to matching primary card type.
    if (cutRole) {
      if (getCardRole(card.name) !== cutRole) continue;
    }
    matches.push(card);
  }

  if (matches.length === 0) return null;

  matches.sort((a, b) => (b.inclusion ?? 0) - (a.inclusion ?? 0));
  const best = matches[0];
  const role = getCardRole(best.name) || undefined;
  return {
    name: best.name,
    price: best.prices?.tcgplayer?.price
      ? best.prices.tcgplayer.price.toFixed(2)
      : best.prices?.cardkingdom?.price
        ? best.prices.cardkingdom.price.toFixed(2)
        : null,
    inclusion: best.inclusion,
    synergy: best.synergy ?? 0,
    typeLine: best.primary_type ?? '',
    cmc: best.cmc,
    imageUrl: best.image_uris?.[0]?.normal,
    role,
    roleLabel: roleLabelFor(role),
  };
}

/** Build a cut/swap move for a card, attaching a replacement when one exists. */
function makeCutMove(
  cutName: string,
  reason: string,
  signal: BracketFitSignal,
  input: BracketFitInput,
  deckNames: Set<string>
): BracketFitMove {
  const role = getCardRole(cutName) || undefined;
  const replacement = findReplacement(cutName, input.targetPool, deckNames, input.gameChangerNames);
  if (replacement) {
    return {
      type: 'swap',
      name: cutName,
      inName: replacement.name,
      reason,
      signal,
      role,
      roleLabel: roleLabelFor(role),
      isGameChanger: input.gameChangerNames.has(cutName),
      inclusion: replacement.inclusion,
      synergy: replacement.synergy,
      cmc: replacement.cmc,
      typeLine: replacement.typeLine,
      imageUrl: replacement.imageUrl,
    };
  }
  return {
    type: 'cut',
    name: cutName,
    reason,
    signal,
    role,
    roleLabel: roleLabelFor(role),
    isGameChanger: input.gameChangerNames.has(cutName),
  };
}

// ── Downshift (too-strong) ────────────────────────────────────────────────────

/**
 * Compute the minimal set of cuts (with optional replacements) that lowers the
 * estimated bracket to <= target. Uses a verify loop against the real
 * estimateBracket so the produced set is exactly what's needed — no over-cut.
 *
 * Cut prioritisation, highest-impact first:
 *   1. Mass land denial (target <= 3 → cut all)
 *   2. Game Changers over allowance (lowest inclusion first)
 *   3. Combos (target <= 2 → break all, including late/setup combos: B1/B2
 *      prohibit ALL intentional 2-card combos; target == 3 → break early combos
 *      only, since B3 allows late/setup combos)
 *   4. Stax over threshold (target <= 2 → below 3; target == 3 → below 5)
 *   5. Extra turns (target == 1 and >= 3 → below 3)
 *   6. Soft bump: cut fast mana (8pts) then tutors (5pts) until soft drops
 *      below the bump threshold.
 */
export function computeDownshiftPlan(
  input: BracketFitInput,
  target: 1 | 2 | 3 | 4 | 5
): BracketFitPlan {
  return computeDownshiftPlanWithTarget(input, target);
}

function computeDownshiftPlanWithTarget(
  input: BracketFitInput,
  target: 1 | 2 | 3 | 4 | 5
): BracketFitPlan {
  const { breakdown } = input.estimation;
  const deckNames = deckNameSet(input.allCardNames);

  // Mutable working copy of the deck card list and the running cut set.
  let working = [...input.allCardNames];
  const cutMoves: BracketFitMove[] = [];
  const cutSet = new Set<string>();

  const cut = (name: string, reason: string, signal: BracketFitSignal) => {
    if (cutSet.has(name)) return;
    cutSet.add(name);
    working = working.filter((n) => n !== name);
    cutMoves.push(makeCutMove(name, reason, signal, input, deckNames));
  };

  const stillAbove = () => reestimate(working, cutSet, input).bracket > target;

  // Ordered queues of removable trigger cards. We pull from them in priority
  // order inside the verify loop, re-checking after each cut so we never cut
  // more than necessary.

  // 1. Mass land denial — prohibited B1–B3.
  const mldQueue = target <= 3 ? [...breakdown.massLandDenialNames] : [];

  // 2. Game Changers over allowance, lowest inclusion (least central) first.
  const allowance = gameChangerAllowance(target);
  const gcSorted = [...breakdown.gameChangerNames].sort(
    (a, b) => (input.cardInclusionMap[a] ?? 0) - (input.cardInclusionMap[b] ?? 0)
  );
  const gcOverAllowance = Number.isFinite(allowance)
    ? gcSorted.slice(0, Math.max(0, breakdown.gameChangerCount - allowance))
    : [];

  // 3. Combos — break the lowest-value piece, preferring a piece unique to one
  //    combo. target <= 2 → break ALL combos, including late-game ones
  //    (bracket=3): B1/B2 prohibit all intentional 2-card combos per the
  //    official rule, and a complete late combo already floors the estimator at
  //    B3, so it sits above a B2 target. target == 3 → early combos only, since
  //    B3 permits late/setup combos.
  const comboTargets: { combo: DetectedCombo }[] = [];
  if (target <= 2) {
    for (const c of input.detectedCombos) comboTargets.push({ combo: c });
  } else if (target === 3) {
    for (const c of input.detectedCombos) if (isEarlyCombo(c)) comboTargets.push({ combo: c });
  }
  // Count how many combos each card appears in (prefer cutting a unique piece).
  const comboPieceFreq = new Map<string, number>();
  for (const { combo } of comboTargets) {
    for (const piece of comboCardNames(combo)) {
      comboPieceFreq.set(piece, (comboPieceFreq.get(piece) ?? 0) + 1);
    }
  }
  const comboQueue: { piece: string; combo: DetectedCombo }[] = [];
  for (const { combo } of comboTargets) {
    const pieces = comboCardNames(combo).filter((p) => deckNames.has(p));
    if (pieces.length === 0) continue;
    // Prefer a piece unique to this combo (freq 1), then lowest inclusion.
    const sorted = [...pieces].sort((a, b) => {
      const ua = comboPieceFreq.get(a) ?? 1;
      const ub = comboPieceFreq.get(b) ?? 1;
      if (ua !== ub) return ua - ub; // unique pieces first
      return (input.cardInclusionMap[a] ?? 0) - (input.cardInclusionMap[b] ?? 0);
    });
    comboQueue.push({ piece: sorted[0], combo });
  }

  // 4. Stax over threshold.
  const staxSorted = [...breakdown.staxPieceNames].sort(
    (a, b) => (input.cardInclusionMap[a] ?? 0) - (input.cardInclusionMap[b] ?? 0)
  );
  let staxToCut = 0;
  if (target <= 2)
    staxToCut = Math.max(0, breakdown.staxPieceCount - 2); // below 3
  else if (target === 3) staxToCut = Math.max(0, breakdown.staxPieceCount - 4); // below 5
  const staxQueue = staxSorted.slice(0, staxToCut);

  // 5. Extra turns — floor B2 at >= 3. Only matters when target == 1.
  const extraTurnSorted = [...breakdown.extraTurnNames].sort(
    (a, b) => (input.cardInclusionMap[a] ?? 0) - (input.cardInclusionMap[b] ?? 0)
  );
  const extraTurnQueue =
    target === 1 && breakdown.extraTurnCount >= 3
      ? extraTurnSorted.slice(0, breakdown.extraTurnCount - 2) // below 3
      : [];

  // 6. Soft contributors — fast mana (8pts) first, then tutors (5pts).
  const fastManaQueue = [...breakdown.fastManaNames];
  const tutorQueue = [...breakdown.tutorNames];

  // ── Verify loop ──
  // Drain queues in priority order; after each cut, stop early the moment the
  // re-estimated bracket reaches the target. This yields the minimal set.
  const hardQueues: Array<{
    items: string[];
    signal: BracketFitSignal;
    reason: (name: string) => string;
  }> = [
    {
      items: mldQueue,
      signal: 'mass-land-denial',
      reason: () =>
        `Mass land denial isn't allowed below Bracket 4 — cut it to reach Bracket ${target}.`,
    },
    {
      items: gcOverAllowance,
      signal: 'game-changer',
      reason: () =>
        `Game Changer over the Bracket ${target} limit (${allowance === 0 ? 'none allowed' : `${allowance} allowed`}).`,
    },
    {
      items: comboQueue.map((c) => c.piece),
      signal: 'combo',
      reason: () => `Breaks an infinite combo that floors the deck above Bracket ${target}.`,
    },
    {
      items: staxQueue,
      signal: 'stax',
      reason: () => `Too many stax pieces for Bracket ${target} — thin them out.`,
    },
    {
      items: extraTurnQueue,
      signal: 'extra-turn',
      reason: () => `Extra-turn chain pushes past Bracket ${target}.`,
    },
  ];

  for (const q of hardQueues) {
    for (const name of q.items) {
      if (!stillAbove()) break;
      cut(name, q.reason(name), q.signal);
    }
    if (!stillAbove()) break;
  }

  // Soft contributors — only if hard cuts didn't already drop us to target.
  if (stillAbove()) {
    for (const name of fastManaQueue) {
      if (!stillAbove()) break;
      cut(
        name,
        `Fast mana adds power density that lifts the deck above Bracket ${target}.`,
        'fast-mana'
      );
    }
  }
  if (stillAbove()) {
    for (const name of tutorQueue) {
      if (!stillAbove()) break;
      cut(name, `Tutors raise consistency past Bracket ${target}.`, 'tutor');
    }
  }

  const achievable = !stillAbove();
  const finalEstimate = reestimate(working, cutSet, input);

  let note: string | undefined;
  if (!achievable) {
    note = `Couldn't reach Bracket ${target} even after every available cut — the deck still estimates at Bracket ${finalEstimate.bracket}. Some power sources here can't be removed without rebuilding.`;
  }

  const summary = achievable
    ? `Cut ${cutMoves.length} card${cutMoves.length === 1 ? '' : 's'} to reach Bracket ${target}.`
    : `Best effort: ${cutMoves.length} cut${cutMoves.length === 1 ? '' : 's'} (still Bracket ${finalEstimate.bracket}).`;

  return {
    direction: 'too-strong',
    targetBracket: target,
    detectedBracket: input.estimation.bracket,
    moves: cutMoves,
    summary,
    achievable,
    note,
    offlineDegraded: input.targetPool === null,
  };
}

// ── Upshift (too-weak) ────────────────────────────────────────────────────────

/**
 * Resolve the missing card names for a oneAway combo. ComboMatch carries oracle
 * ids; the combo's card list maps oracle id → card name.
 */
function oneAwayMissingNames(match: ComboMatch): string[] {
  const missing = new Set(match.missingOracleIds);
  return match.combo.cards.filter((c) => missing.has(c.oracleId)).map((c) => c.cardName);
}

/**
 * Build add suggestions that move the deck toward the target bracket.
 * Priority: (1) oneAway combo completion (deterministic power jump),
 * (2) missing Game Changers at the target level, (3) fast mana / tutors /
 * high-inclusion gap cards from the target pool.
 */
function computeUpshiftPlanWithTarget(
  input: BracketFitInput,
  target: 1 | 2 | 3 | 4 | 5,
  ceiling: boolean
): BracketFitPlan {
  const deckNames = deckNameSet(input.allCardNames);
  const moves: BracketFitMove[] = [];
  const added = new Set<string>();

  const addCard = (
    card: {
      name: string;
      inclusion?: number;
      synergy?: number;
      cmc?: number;
      typeLine?: string;
      imageUrl?: string;
      isGameChanger?: boolean;
    },
    reason: string,
    signal: BracketFitSignal
  ) => {
    if (added.has(card.name) || deckNames.has(card.name)) return;
    added.add(card.name);
    const role = getCardRole(card.name) || undefined;
    moves.push({
      type: 'add',
      name: card.name,
      reason,
      signal,
      role,
      roleLabel: roleLabelFor(role),
      inclusion: card.inclusion,
      synergy: card.synergy,
      cmc: card.cmc,
      typeLine: card.typeLine,
      imageUrl: card.imageUrl,
      isGameChanger: card.isGameChanger,
    });
  };

  // 1. oneAway combo completion — always highest priority.
  for (const match of input.oneAwayCombos) {
    const missing = oneAwayMissingNames(match).filter((n) => !deckNames.has(n));
    if (missing.length !== 1) continue; // only truly "one away" adds are deterministic
    const name = missing[0];
    // Enrich from the pool if available.
    const poolCard = input.targetPool?.cardlists.allNonLand.find((c) => c.name === name);
    addCard(
      {
        name,
        inclusion: poolCard?.inclusion,
        synergy: poolCard?.synergy,
        cmc: poolCard?.cmc,
        typeLine: poolCard?.primary_type,
        imageUrl: poolCard?.image_uris?.[0]?.normal,
        isGameChanger: poolCard?.isGameChanger,
      },
      `Completes a combo — adding this single card finishes a known infinite, a deterministic jump toward Bracket ${target}.`,
      'upshift-combo'
    );
  }

  // The B5 ceiling case adds only combo completions (above) — B4 and B5 are
  // indistinguishable at deckbuilding level.
  if (!ceiling && input.targetPool) {
    const pool = input.targetPool.cardlists.allNonLand;

    // 2. Missing Game Changers at the target level (B3 → up to 3; B4+ → more).
    const gcLimit = target >= 4 ? 6 : 3;
    const missingGCs = pool
      .filter(
        (c) => (c.isGameChanger || input.gameChangerNames.has(c.name)) && !deckNames.has(c.name)
      )
      .sort((a, b) => (b.inclusion ?? 0) - (a.inclusion ?? 0))
      .slice(0, gcLimit);
    for (const c of missingGCs) {
      addCard(
        {
          name: c.name,
          inclusion: c.inclusion,
          synergy: c.synergy,
          cmc: c.cmc,
          typeLine: c.primary_type,
          imageUrl: c.image_uris?.[0]?.normal,
          isGameChanger: true,
        },
        `Game Changer the deck lacks — the most direct way to raise it toward Bracket ${target}.`,
        'upshift-gc'
      );
    }

    // 3. Fill with high-inclusion gap cards (engines / tutors / interaction).
    const fillLimit = target >= 4 ? 5 : 3;
    let filled = 0;
    for (const g of input.gapAnalysis) {
      if (filled >= fillLimit) break;
      if (added.has(g.name) || deckNames.has(g.name)) continue;
      addCard(
        {
          name: g.name,
          inclusion: g.inclusion,
          synergy: g.synergy,
          cmc: g.cmc,
          typeLine: g.typeLine,
          imageUrl: g.imageUrl,
        },
        `Popular high-power inclusion for this commander — tightens the deck toward Bracket ${target}.`,
        'upshift-fill'
      );
      filled++;
    }
  }

  let note: string | undefined;
  if (ceiling) {
    note =
      'Already at the build ceiling — Bracket 5 is mindset and metagame, not more cards. Showing combo-completion opportunities only.';
  }

  const offlineDegraded = input.targetPool === null;
  if (offlineDegraded && moves.length === 0) {
    note =
      note ?? 'Connect to EDHREC for power-up suggestions — no card pool is available offline.';
  }

  const summary =
    moves.length > 0
      ? `Add ${moves.length} card${moves.length === 1 ? '' : 's'} to reach Bracket ${target}.`
      : `No concrete adds available${offlineDegraded ? ' offline' : ''}.`;

  return {
    direction: 'too-weak',
    targetBracket: target,
    detectedBracket: input.estimation.bracket,
    moves,
    summary,
    achievable: true, // adds are always "achievable"; we just suggest what we can
    note,
    offlineDegraded,
  };
}

// Re-export with a stable public name for direct unit testing.
export function computeUpshiftPlan(
  input: BracketFitInput,
  target: 1 | 2 | 3 | 4 | 5,
  ceiling = false
): BracketFitPlan {
  return computeUpshiftPlanWithTarget(input, target, ceiling);
}

// ── Top-level entry ───────────────────────────────────────────────────────────

/**
 * Top-level Bracket Fit planner. Dispatches to downshift / upshift / aligned
 * based on the detected vs target bracket, handling the B4 == B5 build-ceiling
 * special case.
 *
 * Returns `null` when there's no target set (bracketOverride null/undefined) or
 * when there's no estimation yet — i.e. nothing to coach. Non-commander decks
 * never set a bracketOverride, so the null guard covers them too.
 */
export function buildBracketFitPlan(
  bracketOverride: 1 | 2 | 3 | 4 | 5 | null | undefined,
  estimation: BracketEstimation | undefined,
  input: Omit<BracketFitInput, 'estimation'>
): BracketFitPlan | null {
  if (bracketOverride == null) return null;
  if (!estimation) return null;

  const target = bracketOverride;
  const detected = estimation.bracket;
  const fullInput: BracketFitInput = { ...input, estimation };

  // B4 == B5 at deckbuilding level. Treat target 5 like 4 for building.
  // If target is 5 and the deck already estimates at 4+, it's "too weak" only in
  // the combo-completion sense (the build ceiling); if it's at 5, it's aligned.
  if (target === 5) {
    if (detected >= 5) {
      return alignedPlan(target, detected);
    }
    if (detected >= 4) {
      // Build ceiling — only combo completions matter.
      return computeUpshiftPlanWithTarget(fullInput, target, /* ceiling */ true);
    }
    // detected < 4 → genuinely under-powered, build toward 4.
    return computeUpshiftPlanWithTarget(fullInput, target, false);
  }

  if (detected === target) {
    return alignedPlan(target, detected);
  }

  if (detected > target) {
    return computeDownshiftPlanWithTarget(fullInput, target);
  }

  // detected < target → too weak.
  return computeUpshiftPlanWithTarget(fullInput, target, false);
}

function alignedPlan(target: 1 | 2 | 3 | 4 | 5, detected: number): BracketFitPlan {
  return {
    direction: 'aligned',
    targetBracket: target,
    detectedBracket: detected,
    moves: [],
    summary: `Aligned — the deck plays at Bracket ${target}.`,
    achievable: true,
    note: `Deck plays at Bracket ${target}.`,
  };
}
