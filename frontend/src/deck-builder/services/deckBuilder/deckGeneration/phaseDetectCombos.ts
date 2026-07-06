import { logger } from '@/lib/logger';
import type { DetectedCombo } from '@/deck-builder/types';
import type { GenerationState } from './state';
import { frontFaceName } from '@/lib/card-text';

// Detect combos present in the generated deck.
// Verbatim extraction from generateDeck: the closed-over containers
// `categories`/`bannedCards` are rewritten to `state.X`; `commander`/
// `partnerCommander` come from `state.context`. No behavior change.
export function detectCombosPhase(state: GenerationState): DetectedCombo[] | undefined {
  const { commander, partnerCommander } = state.context;

  let detectedCombos: DetectedCombo[] | undefined;
  if (state.combos.length > 0) {
    const allDeckNames = new Set<string>();
    // Include commander(s) — they're part of the deck but not in categories
    if (commander) {
      allDeckNames.add(commander.name);
      if (commander.name.includes(' // ')) allDeckNames.add(frontFaceName(commander.name));
    }
    if (partnerCommander) {
      allDeckNames.add(partnerCommander.name);
      if (partnerCommander.name.includes(' // '))
        allDeckNames.add(frontFaceName(partnerCommander.name));
    }
    for (const c of Object.values(state.categories).flat()) {
      allDeckNames.add(c.name);
      if (c.name.includes(' // ')) allDeckNames.add(frontFaceName(c.name));
    }

    detectedCombos = state.combos
      .filter((combo) => !combo.cards.some((c) => state.bannedCards.has(c.name)))
      .map((combo) => {
        const comboCardNames = combo.cards.map((c) => c.name);
        const missingCards = comboCardNames.filter((name) => !allDeckNames.has(name));

        return {
          comboId: combo.comboId,
          cards: comboCardNames,
          results: combo.results,
          isComplete: missingCards.length === 0,
          missingCards,
          deckCount: combo.deckCount,
          bracket: combo.bracket,
          bracketTag: combo.bracketTag ?? null,
          cardCount: combo.cardCount,
        };
      })
      .filter((dc) => dc.isComplete || dc.missingCards.length <= 2);

    // Deduplicate combos with identical card sets (keep higher deck count)
    {
      const seen = new Map<string, number>();
      detectedCombos = detectedCombos.filter((combo, idx) => {
        const key = [...combo.cards].sort().join('|');
        const existing = seen.get(key);
        if (existing !== undefined) {
          // Keep the one with higher deck count
          if (combo.deckCount > detectedCombos![existing].deckCount) {
            detectedCombos![existing] = combo;
          }
          return false;
        }
        seen.set(key, idx);
        return true;
      });
    }

    // Float commander combos to the top within each completeness group
    const commanderNames = new Set<string>();
    if (commander) {
      commanderNames.add(commander.name);
      if (commander.name.includes(' // ')) commanderNames.add(frontFaceName(commander.name));
    }
    if (partnerCommander) {
      commanderNames.add(partnerCommander.name);
      if (partnerCommander.name.includes(' // '))
        commanderNames.add(frontFaceName(partnerCommander.name));
    }
    detectedCombos.sort((a, b) => {
      if (a.isComplete !== b.isComplete) return a.isComplete ? -1 : 1;
      const aHasCommander = a.cards.some((n) => commanderNames.has(n));
      const bHasCommander = b.cards.some((n) => commanderNames.has(n));
      if (aHasCommander !== bHasCommander) return aHasCommander ? -1 : 1;
      return b.deckCount - a.deckCount;
    });

    logger.debug(
      `[DeckGen] Detected ${detectedCombos.filter((c) => c.isComplete).length} complete combos, ${detectedCombos.filter((c) => !c.isComplete).length} near-misses`
    );

    if (detectedCombos.length === 0) detectedCombos = undefined;
  }

  return detectedCombos;
}

// Recompute isComplete/missingCards for an already-detected combo list
// against whatever `state.categories` holds RIGHT NOW. Several post-fill
// phases (combo audit, coherence repair, bracket/budget convergence) already
// call this exact map+filter idiom inline after their own swaps — this is
// the same logic, extracted so a final catch-all call can run unconditionally
// right before the report is built (see deckGenerator.ts), instead of relying
// on every phase remembering to refresh combo state after a cut.
export function refreshComboCompleteness(
  detectedCombos: DetectedCombo[] | undefined,
  state: GenerationState
): DetectedCombo[] | undefined {
  if (!detectedCombos) return detectedCombos;
  const { commander, partnerCommander } = state.context;
  const liveNames = new Set<string>();
  if (commander) {
    liveNames.add(commander.name);
    if (commander.name.includes(' // ')) liveNames.add(frontFaceName(commander.name));
  }
  if (partnerCommander) {
    liveNames.add(partnerCommander.name);
    if (partnerCommander.name.includes(' // ')) liveNames.add(frontFaceName(partnerCommander.name));
  }
  for (const c of Object.values(state.categories).flat()) {
    liveNames.add(c.name);
    if (c.name.includes(' // ')) liveNames.add(frontFaceName(c.name));
  }
  const refreshed = detectedCombos
    .map((dc) => {
      const missing = dc.cards.filter((n) => !liveNames.has(n));
      return { ...dc, isComplete: missing.length === 0, missingCards: missing };
    })
    .filter((dc) => dc.isComplete || dc.missingCards.length <= 2);
  return refreshed.length > 0 ? refreshed : undefined;
}
