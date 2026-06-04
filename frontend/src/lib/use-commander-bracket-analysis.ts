import { useEffect, useMemo, useRef } from 'react';
import type { Deck } from '../store/decks';
import type { ComboMatchResponse } from '../types/combos';
import {
  analyzeCommanderDeck,
  comboMatchesToDetected,
} from '@/deck-builder/services/deckBuilder/commanderDeckAnalysis';

interface Args {
  deck: Deck | null;
  /** Latest combos-panel result (data only); used for the bracket combo floor. */
  comboData: ComboMatchResponse | null;
  /** Numeric mainboard size from the format config (99 for Commander). */
  mainboardSize: number | undefined;
  /** Whether the deck's format has a commander (gates the whole feature). */
  hasCommander: boolean;
  colorIdentity: string[];
  updateDeck: (id: string, updates: Partial<Omit<Deck, 'id' | 'createdAt'>>) => void;
  /**
   * The user's target bracket (Deck.bracketOverride). Folded into the analysis
   * signature so the Bracket Fit plan recomputes when the target changes — not
   * only when cards change. Absent/null → no target, bracketFit recorded as null.
   */
  bracketOverride?: 1 | 2 | 3 | 4 | 5 | null;
}

const DEBOUNCE_MS = 500;

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
 */
const ANALYSIS_ENGINE_VERSION = 'v2';

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
 * No-ops for non-commander formats, decks without a commander, and when EDHREC
 * is unreachable (the existing values, if any, are left untouched).
 */
export function useCommanderBracketAnalysis(args: Args): void {
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
  // one, and a signature whose fetch failed so we don't hammer EDHREC in a
  // loop within the session (a remount or further edit still retries).
  const reqIdRef = useRef(0);
  const failedSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !deck || mainboardSize == null || !deck.commander) return;
    if (!signature) return;
    if (signature === persistedSignature) return;
    if (signature === failedSignatureRef.current) return;

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
      analyzeCommanderDeck({
        commander,
        partnerCommander,
        cards,
        deckSize: mainboardSize,
        colorIdentity,
        detectedCombos,
        targetBracket,
        oneAwayCombos,
      })
        .then((result) => {
          if (reqIdRef.current !== myReqId) return;
          if (!result) {
            // EDHREC unreachable / commander not found — leave existing
            // grade/bracket as-is and avoid re-looping this session.
            failedSignatureRef.current = signature;
            return;
          }
          failedSignatureRef.current = null;
          updateDeck(deckId, {
            deckGrade: result.deckGrade,
            bracketEstimation: result.bracketEstimation,
            roleTargets: result.roleTargets,
            gapAnalysis: result.gapAnalysis,
            cardInclusionMap: result.cardInclusionMap,
            planScore: result.planScore,
            optimizeSwaps: result.optimizeSwaps,
            costPlan: result.costPlan,
            synergyAnalysis: result.synergyAnalysis,
            // null when no target set / non-commander — clears a stale plan.
            bracketFit: result.bracketFit ?? null,
            gradeBracketSignature: signature,
          });
        })
        .catch(() => {
          if (reqIdRef.current !== myReqId) return;
          failedSignatureRef.current = signature;
        });
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
    // colorIdentity is derived from the commander, which is covered by
    // `signature`; depending on the array identity would thrash the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, persistedSignature, enabled]);
}
