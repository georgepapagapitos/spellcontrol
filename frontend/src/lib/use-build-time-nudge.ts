import { useCallback, useEffect, useRef, useState } from 'react';
import { getLocalMutationToken } from '../store/decks';
import type { Deck } from '../store/decks';
import type { ComboMatchResponse } from '../types/combos';

export type BuildTimeNudgeKind = 'combo' | 'wincon' | 'bracket';

export interface BuildTimeNudge {
  /** Stable id for the current fact — changes when the underlying signal
   *  changes (a different combo / bracket value), stable otherwise. */
  id: string;
  kind: BuildTimeNudgeKind;
  headline: string;
  detail: string;
}

interface Baseline {
  deckId: string;
  cardName: string;
  tokenBefore: number;
  bracketBefore: number | undefined;
  hadWinCondition: boolean;
  expiresAt: number;
}

/** Give the debounced live-analysis effect (500ms, see
 *  useCommanderBracketAnalysis) and the combo fetch (250ms debounce + network,
 *  see useDeckCombos) room to land before giving up on an armed add. */
const ARM_WINDOW_MS = 6000;

/**
 * Bracket-movement nudges are noise below this fraction of the format's
 * mainboard target — the estimate swings on nearly every card while the deck
 * is still mostly empty slots, so a "moved to bracket N" callout that early
 * isn't actionable (a 6-card deck says nothing about a 99-card deck's
 * bracket). Combo-completion and first-win-condition signals get no such
 * floor: they're discrete facts, true the instant their pieces are present,
 * not a statistical estimate that needs a sample to stabilize.
 */
const BRACKET_SIGNAL_MIN_FRACTION = 0.4;

/**
 * Build-time coach nudge (E169 Half B): the moment a card lands in the
 * mainboard, check whether it just completed a combo, handed the deck its
 * first win condition, or (once the deck is mostly built) moved the bracket
 * estimate — and surface AT MOST ONE, the highest-priority genuine signal.
 * Combo beats win-condition beats bracket: a completed combo is the rarest,
 * least ambiguous event, bracket movement the most routine.
 *
 * This computes nothing new — every value it reads (deck.bracketEstimation,
 * deck.winConditions, comboData.inDeck) is already kept live for every
 * commander deck, generated and manual alike (see
 * useCommanderBracketAnalysis / useDeckCombos). This hook only decides WHEN a
 * value that already exists is worth interrupting the add flow for.
 *
 * GUARD: bracketEstimation/winConditions are written by that live analysis
 * effect on a debounce, and can also arrive from a remote sync pull with no
 * local edit at all. Gating on isApplyingServer()/isApplyingAnalysis() from
 * inside an effect does NOT work here — those flags are a
 * synchronous-window-only signal (see the comment on touch() in
 * store/decks.ts) and have already reverted to false by the time an async
 * effect reads them, regardless of the write's origin. Instead this hook
 * snapshots the deck's local-mutation token (E177) when armed and only trusts
 * a settle once the token has advanced since — that counter is bumped
 * synchronously ONLY by genuine local mutations (touch()), never by a
 * server-apply or rehydration.
 */
export function useBuildTimeNudge(args: {
  deckId: string | undefined;
  deck: Deck | null;
  comboData: ComboMatchResponse | null;
  /** Format's mainboard target (e.g. 99 for Commander) — drives the
   *  bracket-signal size floor. */
  mainboardTarget: number | undefined;
}): {
  nudge: BuildTimeNudge | null;
  /** Call synchronously, BEFORE triggering the store mutation, with the name
   *  of the card about to land in the mainboard. Arms the guard's baseline. */
  notifyMainboardAdd: (cardName: string) => void;
  dismiss: () => void;
} {
  const { deckId, deck, comboData, mainboardTarget } = args;
  const baselineRef = useRef<Baseline | null>(null);
  const [nudge, setNudge] = useState<BuildTimeNudge | null>(null);

  // Switching decks (react-router reuses this component across a `:id` param
  // change — no remount) discards any nudge still on screen from the
  // previous one. A render-phase adjustment (react.dev "storing information
  // from previous renders"), tracked via useState rather than a ref: this
  // codebase's lint config (react-hooks/refs) bans reading/writing a ref
  // during render, so the "did the identity prop change" check itself has to
  // live in state, like useDeckCombos's own `trackedKey` does.
  const [trackedDeckId, setTrackedDeckId] = useState(deckId);
  if (trackedDeckId !== deckId) {
    setTrackedDeckId(deckId);
    if (nudge !== null) setNudge(null);
  }

  // The baseline ref itself is fine to reset in an effect (never during
  // render) — bare ref mutation, no setState call, so it doesn't trip
  // react-hooks/set-state-in-effect either.
  useEffect(() => {
    baselineRef.current = null;
  }, [deckId]);

  const notifyMainboardAdd = useCallback(
    (cardName: string) => {
      if (!deckId || !deck) return;
      baselineRef.current = {
        deckId,
        cardName,
        tokenBefore: getLocalMutationToken(deckId),
        bracketBefore: deck.bracketEstimation?.bracket,
        hadWinCondition: !!deck.winConditions?.primary && !deck.winConditions.noClearWinCondition,
        expiresAt: Date.now() + ARM_WINDOW_MS,
      };
      setNudge(null);
    },
    [deckId, deck]
  );

  const dismiss = useCallback(() => setNudge(null), []);

  useEffect(() => {
    const baseline = baselineRef.current;
    if (!deckId || !deck || !baseline || baseline.deckId !== deckId) return;
    if (Date.now() > baseline.expiresAt) {
      baselineRef.current = null;
      return;
    }
    // The guard: without a genuine local mutation since baseline, this settle
    // can't be attributed to the user's own add — it's indistinguishable from
    // a coincidental remote write, so never surface it as "you just did this".
    if (getLocalMutationToken(deckId) <= baseline.tokenBefore) return;

    const cardName = baseline.cardName;
    const stillPresent = deck.cards.some(
      (c) => c.card.name.toLowerCase() === cardName.toLowerCase()
    );
    if (!stillPresent) {
      baselineRef.current = null;
      return;
    }

    // 1. Combo completion — the highest-signal, least ambiguous event. A
    // combo can only be `inDeck` (every piece present) with the just-added
    // card among its pieces if this add was the piece that completed it.
    const completed = comboData?.inDeck.find((m) =>
      m.combo.cards.some((c) => c.cardName.toLowerCase() === cardName.toLowerCase())
    );
    if (completed) {
      baselineRef.current = null;
      const produces = completed.combo.produces[0];
      const pieces = completed.combo.cards.map((c) => c.cardName).join(' + ');
      setNudge({
        id: `combo-${completed.combo.id}`,
        kind: 'combo',
        headline: `${cardName} completes a combo`,
        detail: produces ? `${pieces} — ${produces}` : pieces,
      });
      return;
    }

    // 2. First win condition the deck has picked up, attributable to this card.
    const wc = deck.winConditions;
    if (
      !baseline.hadWinCondition &&
      wc?.primary &&
      !wc.noClearWinCondition &&
      wc.primary.evidence.some((n) => n.toLowerCase() === cardName.toLowerCase())
    ) {
      baselineRef.current = null;
      setNudge({
        id: `wincon-${wc.primary.category}`,
        kind: 'wincon',
        headline: `${cardName} gives this deck a win condition`,
        detail: wc.primary.summary,
      });
      return;
    }

    // 3. Bracket movement — only once the deck's shape has mostly settled
    // (see BRACKET_SIGNAL_MIN_FRACTION).
    const target = mainboardTarget ?? 99;
    const bracketAfter = deck.bracketEstimation?.bracket;
    if (
      deck.cards.length >= target * BRACKET_SIGNAL_MIN_FRACTION &&
      bracketAfter != null &&
      baseline.bracketBefore != null &&
      bracketAfter !== baseline.bracketBefore
    ) {
      baselineRef.current = null;
      setNudge({
        id: `bracket-${bracketAfter}`,
        kind: 'bracket',
        headline: `Bracket estimate moved to ${bracketAfter}`,
        detail: deck.bracketEstimation?.label ?? '',
      });
      return;
    }
    // No signal yet this pass — stay armed until expiresAt so a slower
    // analysis leg (bracket/wincon settle after combos) still gets a look.
  }, [deckId, deck, comboData, mainboardTarget]);

  return { nudge, notifyMainboardAdd, dismiss };
}
