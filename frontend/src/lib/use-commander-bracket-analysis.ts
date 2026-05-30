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
}

const DEBOUNCE_MS = 500;

/**
 * Signature of every input that materially affects grade/bracket: commander(s)
 * + the sorted mainboard card-name multiset + the matched in-deck combo ids.
 * Combo ids are folded in because they load asynchronously — including them
 * makes the analysis recompute once combos arrive (or change with the deck).
 */
function buildSignature(deck: Deck, comboData: ComboMatchResponse | null): string {
  const cardNames = deck.cards.map((c) => c.card.name).sort();
  const comboIds = (comboData?.inDeck ?? []).map((m) => m.combo.id).sort();
  return [
    deck.commander?.name ?? '',
    deck.partnerCommander?.name ?? '',
    cardNames.join(','),
    comboIds.join(','),
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
  const { deck, comboData, mainboardSize, hasCommander, colorIdentity, updateDeck } = args;

  const enabled = Boolean(deck && hasCommander && deck.commander && mainboardSize != null);

  const signature = useMemo(
    () => (deck && enabled ? buildSignature(deck, comboData) : ''),
    [deck, comboData, enabled]
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

    const myReqId = ++reqIdRef.current;
    const timer = window.setTimeout(() => {
      analyzeCommanderDeck({
        commander,
        partnerCommander,
        cards,
        deckSize: mainboardSize,
        colorIdentity,
        detectedCombos,
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
