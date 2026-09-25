import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Deck } from '../store/decks';
import type { ComboMatchResponse } from '../types/combos';
import {
  analyzeCommanderDeck,
  comboMatchesToDetected,
} from '@/deck-builder/services/deckBuilder/commanderDeckAnalysis';
import { setApplyingAnalysis } from './applying-analysis';

interface Args {
  deck: Deck | null;
  /** Latest combos-panel result (data only); used for the bracket combo floor. */
  comboData: ComboMatchResponse | null;
  /**
   * True while the combo match is in flight. `comboData` is null both while
   * loading and when the match failed, so without this the analysis ran on "no
   * combos", persisted the lower bracket over a correct one, then recomputed
   * when combos landed: every visit read 3, then jumped to 4. Combos only ever
   * raise the estimate, so the analysis waits for them (a deck with no
   * estimate yet waits up to COMBO_WAIT_MS).
   */
  combosLoading: boolean;
  /** Numeric mainboard size from the format config (99 for Commander). */
  mainboardSize: number | undefined;
  /** Whether the deck's format has a commander (gates the whole feature). */
  hasCommander: boolean;
  colorIdentity: string[];
  updateDeck: (
    id: string,
    updates: Partial<Omit<Deck, 'id' | 'createdAt'>>,
    silent?: boolean
  ) => void;
  /**
   * The user's target bracket (Deck.bracketOverride). Folded into the analysis
   * signature so the Bracket Fit plan recomputes when the target changes — not
   * only when cards change. Absent/null → no target, bracketFit recorded as null.
   */
  bracketOverride?: 1 | 2 | 3 | 4 | 5 | null;
}

const DEBOUNCE_MS = 500;

/**
 * How long the analysis holds for the combo match before running without it.
 * A warm device matches in well under this; a cold one downloads the whole
 * dataset first (10–40 s on a phone), and the rest of the Power and Coach tabs
 * should not sit behind that. An estimate made without combos is marked in its
 * signature, the UI calls it a floor, and it recomputes once combos land.
 */
const COMBO_WAIT_MS = 6_000;

/** Signature segment for "the combo match hadn't answered": not the same as no combos. */
const COMBOS_UNCHECKED = '?';

/**
 * E162: a defensive ceiling on a single analysis attempt. `analyzeCommanderDeck`
 * already catches its own errors and resolves to `null` rather than hanging, so
 * this shouldn't normally fire — but its EDHREC fetch has no AbortController/
 * timeout of its own, so a genuinely stuck network request would otherwise pend
 * forever with no way for the UI to tell "still working" from "stalled". Treated
 * identically to a `null` result: marks the signature failed, surfaces 'error'.
 */
const STALL_TIMEOUT_MS = 20_000;

function withStallTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Analysis stalled')), ms);
    promise.then(
      (v) => {
        window.clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * Bump when the analysis ENGINE changes in a way that should invalidate every
 * persisted result (deck.bracketFit / gapAnalysis / optimizeSwaps / …) even
 * though the deck's cards/commander/target are unchanged. Folded into the
 * signature, so a bump forces a one-time recompute the next time each deck's
 * analysis runs — no manual toggle or deck edit needed.
 *
 * History:
 *   v2 — Bracket Fit: capped upshift suggestions (≤5 one-away combos, ≤12 total)
 *        + full-deck add↔cut pairing. v1 plans had unbounded "swap in N" lists.
 *   v3 — added win-condition detection + restored Bracket Fit alongside it; bumped
 *        to bust any cache from the window when Bracket Fit was missing from main.
 *   v4 — win conditions gained `assembly` (E75 assembly clock); bumped so
 *        persisted analyses recompute and the clock surfaces can render.
 *   v5 — win-condition detector rewrite (#1870, #1876): burn needs burn
 *        spells, permanent damage engines count, the command zone is
 *        evidence, token-loop combos are a win path. Without a bump every
 *        deck kept its persisted "Burn — 0 direct-damage spells" label
 *        until its cards changed.
 *   v6 — combo-label audit: +1/+1-counter / infinitely-large / combat-phase
 *        loops are win paths, self-library exile and opponent-gifted tokens
 *        are not.
 *   v7 — bracket combo relevance: Spellbook Exhibition/Core combos no longer
 *        floor, lines through one bottleneck card count once for redundancy,
 *        a commander combo piece speeds assembly. Moved 11 of 197 precons off
 *        a false floor, so every persisted estimate needs the recompute.
 *   v8 — matched to Commander Spellbook: a commander + up to two cards floors
 *        at 4, Gideon, Champion of Justice and Whims of the Fates count as land
 *        denial, and a combo that needs an unnamed card sets no floor. The
 *        browser's combo data now carries bracketTag at all (it never had).
 *   v9 — loops that set no floor (drawing your library) add combo-engine
 *        points to the power signal and are named in the Bracket panel.
 *   v10 — stress test: land-only searches aren't tutors (504 → 79 across the
 *        precons), cEDH needs 4+ Game Changers, separate combo packages count
 *        as separate engines, a lone sub-gate combo adds power, and a half-built
 *        deck no longer divides its interaction by 1.
 *   v11 — a loop that only draws cards (infinite draw / storm count, no
 *        payoff) is no longer a win path, so the Gameplan hero and Win
 *        conditions stop saying "Wins via Infinite combo" beside a Bracket
 *        panel that says the same loops don't end the game (E380).
 *   v12 — the combo floor's explanation quotes the RC's actual rule
 *        (intentional infinite combos, not only ones that end the game);
 *        it is stored in each hard floor's `detail` (E382).
 *   v13 — Bracket Fit accuracy pass: upshift one-away combo completions
 *        respect the combo's own bracket effect (an E/C-tagged or
 *        template-variant completion no longer claims a floor move it
 *        doesn't make; a Ruthless two-card or commander combo is no longer
 *        suggested toward a Bracket 3 target, since completing it overshoots
 *        to 4); upshift now verifies every accepted move against the real
 *        estimator instead of hard-coding `achievable: true`; downshift
 *        replacements can no longer be fast mana, a tutor, or the missing
 *        piece of a floor-setting one-away combo, and a replacement that
 *        would re-raise the bracket degrades to a plain cut.
 *   v14 — combos completed only via a sideboard card no longer set a bracket
 *        floor, feed the coach, or count toward the hero's combo totals (only
 *        commander(s) + mainboard do — see combo-zone-partition.ts); and an
 *        unreachable EDHREC no longer blanks the whole analysis — the local
 *        bracket/win-conditions/bracket-fit are computed and persisted with
 *        `edhrecMissing: true` instead.
 *   v15 — a combo's unnamed-card ("template", the `--` variant suffix) is
 *        now RESOLVED against the deck's own cards instead of always
 *        dropped: `templatesSatisfied` lets it count toward the combo floor
 *        like any other complete combo once a deck card matches its query.
 */
const ANALYSIS_ENGINE_VERSION = 'v15-combo-templates-resolved';

/** Suffix marking a persisted `gradeBracketSignature` as a PARTIAL result
 *  (EDHREC was unreachable). Distinguishes it from a full result computed for
 *  the exact same signature so a fresh mount (the next visit) retries EDHREC
 *  even though the deck's content hasn't changed — see `edhrecMissingAttempted`
 *  below for the within-session half of that (don't loop on every re-render). */
const EDHREC_MISSING_SUFFIX = '#edhrec-missing';

/**
 * Signature of every input that materially affects grade/bracket: commander(s)
 * + the sorted mainboard card-name multiset + the matched in-deck combo ids +
 * the user's target bracket. Combo ids are folded in because they load
 * asynchronously — including them makes the analysis recompute once combos
 * arrive (or change with the deck). The target bracket is folded in so the
 * Bracket Fit plan recomputes the moment the user picks/changes/clears a target,
 * even when the card list is unchanged.
 */
function buildSignature(
  deck: Deck,
  comboData: ComboMatchResponse | null,
  bracketOverride?: 1 | 2 | 3 | 4 | 5 | null
): string {
  const cardNames = deck.cards.map((c) => c.card.name).sort();
  const comboIds = comboData
    ? comboData.inDeck
        .map((m) => m.combo.id)
        .sort()
        .join(',')
    : COMBOS_UNCHECKED;
  return [
    ANALYSIS_ENGINE_VERSION,
    deck.commander?.name ?? '',
    deck.partnerCommander?.name ?? '',
    cardNames.join(','),
    comboIds,
    String(bracketOverride ?? ''),
  ].join('|');
}

/**
 * Keeps a commander deck's `deckGrade` / `bracketEstimation` live as its cards
 * change — for generated and manual decks alike.
 *
 * When the deck's material inputs change it (debounced) fetches cached EDHREC
 * data, recomputes grade + bracket, and persists them onto the deck record
 * alongside a signature so we don't recompute until something actually changes.
 * Generated decks seed these at generation; this hook then keeps the estimate
 * from going stale when the user edits the list (the estimate is functionally
 * identical to the generation snapshot — `estimateBracket` ignores deckScore —
 * so a recompute refines rather than contradicts it). The user's manual
 * `bracketOverride`, when set, is layered on at display time and is never
 * touched here.
 *
 * No-ops for non-commander formats and decks without a commander. When EDHREC
 * is unreachable (or the analysis otherwise fails/stalls) the existing
 * `deck.gradeBracketSignature`, if any, is left untouched — but if the deck
 * has *never* had a successful analysis, the returned `status` surfaces
 * 'error' instead of leaving the caller's "pending" skeleton spinning forever
 * with no way to tell a slow first analysis from a permanently failed one
 * (E162). `retry()` clears the failure and re-attempts immediately.
 */
export function useCommanderBracketAnalysis(args: Args): {
  status: 'pending' | 'ready' | 'error';
  retry: () => void;
  /**
   * The persisted estimate was made before the combo match answered (it timed
   * out or failed), so its bracket is a floor: combos can only raise it.
   */
  missesCombos: boolean;
  /**
   * The persisted estimate was computed without EDHREC (unreachable / this
   * commander isn't indexed) — the bracket and win conditions are real, but
   * grade/gaps/hidden gems/plan score/cost & optimize lanes are absent.
   * `retry()` also clears this and re-attempts EDHREC.
   */
  edhrecMissing: boolean;
} {
  const {
    deck,
    comboData,
    combosLoading,
    mainboardSize,
    hasCommander,
    colorIdentity,
    updateDeck,
    bracketOverride,
  } = args;

  const enabled = Boolean(deck && hasCommander && deck.commander && mainboardSize != null);

  const signature = useMemo(
    () => (deck && enabled ? buildSignature(deck, comboData, bracketOverride) : ''),
    [deck, comboData, enabled, bracketOverride]
  );

  const persistedSignature = deck?.gradeBracketSignature;

  // Tracks the latest request so a stale async result can't clobber a fresher
  // one. `failedSignature` is state (not a ref) so a failure re-renders and
  // the caller can surface an 'error' status instead of an endless skeleton
  // (E162) — reactive because it also gates the effect below, so we don't
  // hammer EDHREC in a loop within the session (a remount, further edit, or
  // explicit retry() all still retry).
  const reqIdRef = useRef(0);
  const [failedSignature, setFailedSignature] = useState<string | null>(null);
  // Bumped by retry() to force the effect below to re-run even when neither
  // `signature` nor `persistedSignature` changed.
  const [retryNonce, setRetryNonce] = useState(0);

  // The signature whose combo wait ran out. Keyed by signature, so a deck edit
  // or the combos landing starts a fresh wait with no reset to manage.
  const [comboWaitOver, setComboWaitOver] = useState<string | null>(null);
  useEffect(() => {
    if (!combosLoading || !signature) return;
    const timer = window.setTimeout(() => setComboWaitOver(signature), COMBO_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [combosLoading, signature]);

  // The signature whose EDHREC fetch already came back missing THIS MOUNT.
  // Local (not persisted), so it resets on the next visit and EDHREC gets
  // retried then — even though the deck's persisted signature (below) already
  // carries the partial result for this exact signature and would otherwise
  // never look stale. Without this, `signature !== persistedSignature`
  // (guaranteed by the suffix) would re-fire the fetch on every unrelated
  // re-run of this effect within the same session.
  const [edhrecMissingAttempted, setEdhrecMissingAttempted] = useState<string | null>(null);

  const retry = useCallback(() => {
    setFailedSignature(null);
    setEdhrecMissingAttempted(null);
    setRetryNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !deck || mainboardSize == null || !deck.commander) return;
    if (!signature) return;
    // Hold for the combo match. Only a deck with no estimate at all stops
    // waiting at COMBO_WAIT_MS: one that has an estimate keeps it on screen
    // rather than trading it for a floor.
    if (combosLoading && (persistedSignature || comboWaitOver !== signature)) return;
    if (signature === persistedSignature) return;
    if (signature === failedSignature) return;
    if (signature === edhrecMissingAttempted) return;

    const deckId = deck.id;
    const commander = deck.commander;
    const partnerCommander = deck.partnerCommander;
    const cards = deck.cards.map((c) => c.card);
    const detectedCombos = comboMatchesToDetected(comboData, cards);
    // The user's target bracket + the live oneAway combos feed the Bracket Fit
    // plan (target-pool fetch + upshift combo-completion adds happen inside).
    const targetBracket = bracketOverride ?? undefined;
    const oneAwayCombos = comboData?.oneAway ?? [];
    // E221: cards generation injected from a theme's EDHREC tag page. Without
    // this the misfit pass flags every one of them (absent from the commander's
    // page by construction) and the Coach recommends cutting exactly what
    // generation deliberately added.
    const archetypeBlendNames = deck.buildReport?.archetypeBlendNames;

    const myReqId = ++reqIdRef.current;
    const timer = window.setTimeout(() => {
      withStallTimeout(
        analyzeCommanderDeck({
          commander,
          partnerCommander,
          cards,
          deckSize: mainboardSize,
          colorIdentity,
          detectedCombos,
          targetBracket,
          oneAwayCombos,
          archetypeBlendNames,
        }),
        STALL_TIMEOUT_MS
      )
        .then((result) => {
          if (reqIdRef.current !== myReqId) return;
          if (!result) {
            // EDHREC unreachable / commander not found — leave existing
            // grade/bracket as-is and avoid re-looping this session.
            setFailedSignature(signature);
            return;
          }
          setFailedSignature(null);
          // Flag the write as analysis-derived so the decks-store subscriber
          // skips enqueueing it into the sync queue. The flag is set
          // synchronously around the store mutation so the subscriber (which
          // also checks synchronously, before the lazy sync import) sees it.
          setApplyingAnalysis(true);
          try {
            updateDeck(
              deckId,
              {
                deckGrade: result.deckGrade,
                bracketEstimation: result.bracketEstimation,
                roleTargets: result.roleTargets,
                gapAnalysis: result.gapAnalysis,
                hiddenGems: result.hiddenGems,
                cardInclusionMap: result.cardInclusionMap,
                planScore: result.planScore,
                misfits: result.misfits,
                edhrecNumDecks: result.edhrecNumDecks ?? null,
                optimizeSwaps: result.optimizeSwaps,
                costPlan: result.costPlan,
                synergyAnalysis: result.synergyAnalysis,
                winConditions: result.winConditions,
                // null when no target set / non-commander — clears a stale plan.
                bracketFit: result.bracketFit ?? null,
                // A partial (EDHREC-missing) result gets a suffixed signature —
                // distinct from the plain one a full analysis would persist for
                // the same deck, so a later successful analysis (deck unchanged,
                // EDHREC back up) doesn't read as "already done" and skip.
                gradeBracketSignature: result.edhrecMissing
                  ? `${signature}${EDHREC_MISSING_SUFFIX}`
                  : signature,
                // silent: derived analysis, not a user edit — don't bump updatedAt
                // (else merely viewing a deck marks it "edited just now").
              },
              true
            );
          } finally {
            setApplyingAnalysis(false);
          }
          if (result.edhrecMissing) setEdhrecMissingAttempted(signature);
        })
        .catch(() => {
          if (reqIdRef.current !== myReqId) return;
          setFailedSignature(signature);
        });
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
    // colorIdentity is derived from the commander, which is covered by
    // `signature`; depending on the array identity would thrash the effect.
    // retryNonce is a manual re-trigger only — its value is never read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    signature,
    persistedSignature,
    enabled,
    failedSignature,
    edhrecMissingAttempted,
    retryNonce,
    combosLoading,
    comboWaitOver,
  ]);

  const status: 'pending' | 'ready' | 'error' =
    !enabled || !signature || !!persistedSignature
      ? 'ready'
      : failedSignature === signature
        ? 'error'
        : 'pending';

  // The combo segment is second to last (only the target follows it), and no
  // card or commander name contains '|'.
  const missesCombos = persistedSignature?.split('|').at(-2) === COMBOS_UNCHECKED;
  const edhrecMissing = persistedSignature?.endsWith(EDHREC_MISSING_SUFFIX) ?? false;

  return { status, retry, missesCombos, edhrecMissing };
}
