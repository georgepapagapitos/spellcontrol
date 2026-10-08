/**
 * Combo completeness: the combos in this commander's combo set (the matcher's
 * complete and near-miss lists, `ctx.combos`) that the deck holds EVERY named
 * piece of, commander included. A combo missing a piece scores nothing, so
 * cutting Hermit Druid from Hermit Druid + Thassa's Oracle is a real loss here,
 * and a lone piece earns no combo credit (its other value is other terms').
 *
 *   w(combo) = min(1, log10(1 + deckCount) / 4)   (10,000 decks → 1)
 *   value = COMBO_SCALE × Σ_i w_i × COMBO_DECAY^i  (complete combos, best first)
 *
 * The decay: a second win line is worth half the first, and so on. Combos
 * earn nothing under a target bracket of 3 or lower: a counted combo floors
 * the deck above it (@spellcontrol/deck-metrics), so there it is a liability
 * the bracket convergence exists to remove, not a payoff. Under
 * `ctx.comboCredit === 'wins'` (Coach, E540 S7) only lines that end the game
 * (`comboEndsGame`) count: a loop that only makes mana or draws earns nothing,
 * unless a payoff the deck holds converts it (E578: infinite untap + Lathril).
 */
import type { DetectedCombo } from '@/deck-builder/types';
import { comboEndsGame } from '@/deck-builder/services/winConditions/detect';
import { deckComboPayoffs } from '@/deck-builder/services/winConditions/comboPayoffs';
import type { CardNote } from '../types';
import { viableCombos } from '../constraints';
import { round2, type TermFn } from './shared';

export const COMBO_SCALE = 2;
export const COMBO_DECAY = 0.5;

export function comboWeight(combo: Pick<DetectedCombo, 'deckCount'>): number {
  return Math.min(1, Math.log10(1 + Math.max(0, combo.deckCount)) / 4);
}

/** Whether a combo earns anything under this target bracket ('all' and 4+ do). */
export function combosCountAtBracket(target: number | string | undefined): boolean {
  return !(typeof target === 'number' && target <= 3);
}

export const combosTerm: TermFn = (deck, ctx) => {
  const combos = ctx.combos ?? [];
  const target = ctx.customization.targetBracket;
  if (!combosCountAtBracket(target)) {
    return { value: 0, summary: `combos earn nothing at target bracket ${target}`, cards: [] };
  }
  const seen = new Set<string>();
  // The deck's own payoffs (commander first) turn a mana/untap/ETB loop into a win (E578).
  const payoffs =
    ctx.comboCredit === 'wins'
      ? deckComboPayoffs([...deck.commanders, ...deck.cards], ctx.factsOf)
      : undefined;
  const complete: Array<{ combo: DetectedCombo; w: number }> = [];
  // Only lines that work in this deck (constraints.ts viableCombos), and under
  // comboCredit 'wins' only the ones that end the game.
  for (const combo of combos.length ? viableCombos(deck, ctx) : []) {
    if (ctx.comboCredit === 'wins' && !comboEndsGame(combo.results, payoffs)) continue;
    const id = [...combo.cards]
      .map((n) => n.toLowerCase())
      .sort()
      .join('|');
    if (seen.has(id)) continue;
    seen.add(id);
    complete.push({ combo, w: comboWeight(combo) });
  }
  complete.sort(
    (a, b) => b.w - a.w || a.combo.cards.join('+').localeCompare(b.combo.cards.join('+'))
  );
  const notes: CardNote[] = [];
  let value = 0;
  complete.forEach(({ combo, w }, i) => {
    const v = COMBO_SCALE * w * COMBO_DECAY ** i;
    value += v;
    const label = combo.cards.join(' + ');
    for (const name of combo.cards) {
      notes.push({
        name,
        value: v / combo.cards.length,
        note: `piece of ${label} (${combo.deckCount} decks${combo.results[0] ? `: ${combo.results[0]}` : ''})`,
      });
    }
  });
  return {
    value,
    summary: complete.length
      ? `${complete.length} complete combos, best ${complete[0].combo.cards.join(' + ')} (w ${round2(complete[0].w)})`
      : 'no complete combo',
    cards: notes,
  };
};
