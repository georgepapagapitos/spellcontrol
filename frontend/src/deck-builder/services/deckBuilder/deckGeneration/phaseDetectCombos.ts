import type { DetectedCombo } from '@/deck-builder/types';
import type { GenerationState } from './state';

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
      if (commander.name.includes(' // ')) allDeckNames.add(commander.name.split(' // ')[0]);
    }
    if (partnerCommander) {
      allDeckNames.add(partnerCommander.name);
      if (partnerCommander.name.includes(' // '))
        allDeckNames.add(partnerCommander.name.split(' // ')[0]);
    }
    for (const c of Object.values(state.categories).flat()) {
      allDeckNames.add(c.name);
      if (c.name.includes(' // ')) allDeckNames.add(c.name.split(' // ')[0]);
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
      if (commander.name.includes(' // ')) commanderNames.add(commander.name.split(' // ')[0]);
    }
    if (partnerCommander) {
      commanderNames.add(partnerCommander.name);
      if (partnerCommander.name.includes(' // '))
        commanderNames.add(partnerCommander.name.split(' // ')[0]);
    }
    detectedCombos.sort((a, b) => {
      if (a.isComplete !== b.isComplete) return a.isComplete ? -1 : 1;
      const aHasCommander = a.cards.some((n) => commanderNames.has(n));
      const bHasCommander = b.cards.some((n) => commanderNames.has(n));
      if (aHasCommander !== bHasCommander) return aHasCommander ? -1 : 1;
      return b.deckCount - a.deckCount;
    });

    console.log(
      `[DeckGen] Detected ${detectedCombos.filter((c) => c.isComplete).length} complete combos, ${detectedCombos.filter((c) => !c.isComplete).length} near-misses`
    );

    if (detectedCombos.length === 0) detectedCombos = undefined;
  }

  return detectedCombos;
}
