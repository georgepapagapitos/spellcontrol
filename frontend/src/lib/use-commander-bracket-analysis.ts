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
 */
const ANALYSIS_ENGINE_VERSION = 'v4-assembly-clock';

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
  const comboIds = (comboData?.inDeck ?? []).map((m) => m.combo.id).sort();
  return [
    ANALYSIS_ENGINE_VERSION,
    deck.commander?.name ?? '',
    deck.partnerCommander?.name ?? '',
    cardNames.join(','),
    comboIds.join(','),
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
} {
  const {
    deck,
    comboData,
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

  const retry = useCallback(() => {
    setFailedSignature(null);
    setRetryNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !deck || mainboardSize == null || !deck.commander) return;
    if (!signature) return;
    if (signature === persistedSignature) return;
    if (signature === failedSignature) return;

    const deckId = deck.id;
    const commander = deck.commander;
    const partnerCommander = deck.partnerCommander;
    const cards = deck.cards.map((c) => c.card);
    const detectedCombos = comboMatchesToDetected(comboData);
    // The user's target bracket + the live oneAway combos feed the Bracket Fit
    // plan (target-pool fetch + upshift combo-completion adds happen inside).
    const targetBracket = bracketOverride ?? undefined;
    const oneAwayCombos = comboData?.oneAway ?? [];

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
                gradeBracketSignature: signature,
                // silent: derived analysis, not a user edit — don't bump updatedAt
                // (else merely viewing a deck marks it "edited just now").
              },
              true
            );
          } finally {
            setApplyingAnalysis(false);
          }
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
  }, [signature, persistedSignature, enabled, failedSignature, retryNonce]);

  const status: 'pending' | 'ready' | 'error' =
    !enabled || !signature || !!persistedSignature
      ? 'ready'
      : failedSignature === signature
        ? 'error'
        : 'pending';

  return { status, retry };
}
