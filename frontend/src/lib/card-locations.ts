import type { BinderDef, EnrichedCard } from '../types';
import { materializeBinders } from './materialize';

/** Where a card physically sits: which binder, and which page of it. */
export interface CardLocation {
  binderId: string;
  binderName: string;
  binderColor?: string;
  /** 1-based page number within the binder, as shown in the binder view. */
  pageNum: number;
}

/**
 * Index every card in the collection by oracle id → the binder page it sits on.
 *
 * Answers "where do I actually find this card?" — the question a physical
 * binder app exists to answer, and the one a combo list is useless without: a
 * combo you can build is only actionable if you can pull its pieces.
 *
 * Like `summarizeImportRouting`, this goes through `materializeBinders` rather
 * than re-running rule matching, so the answer agrees with what the user sees
 * when they open the binder — including deck-allocation hiding, pinned-card
 * promotion, and printing selection. Re-deriving membership here would
 * silently disagree the moment one of those quirks applies.
 *
 * First match wins: a card whose copies span several binders reports the first
 * by binder position, mirroring the routing engine's own first-match-wins rule.
 */
export function buildCardLocationIndex(
  cards: EnrichedCard[],
  binderDefs: BinderDef[]
): Map<string, CardLocation> {
  const byOracle = new Map<string, CardLocation>();
  if (cards.length === 0 || binderDefs.length === 0) return byOracle;

  const { binders } = materializeBinders(cards, binderDefs, {
    globalPocketSize: 9,
    search: '',
  });

  for (const b of binders) {
    for (const section of b.sections) {
      for (const page of section.pages) {
        for (const slot of page.slots) {
          if (!slot?.oracleId || byOracle.has(slot.oracleId)) continue;
          byOracle.set(slot.oracleId, {
            binderId: b.def.id,
            binderName: b.def.name,
            binderColor: b.def.color,
            pageNum: page.pageNum,
          });
        }
      }
    }
  }

  return byOracle;
}
