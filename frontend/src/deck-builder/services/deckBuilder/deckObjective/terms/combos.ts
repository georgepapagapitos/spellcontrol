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
 * The decay: a second win line is worth half the first, and so on. The ranking
 * is by FAMILY first (E1059): a combo that shares all but one card with a line
 * already counted is a variant of it (Top + Forge + Cloud Key, + Jhoira's
 * Familiar, + Ugin) and tops up that family (a noisy-or: redundancy, never a
 * second line); the decay runs over families. Kozilek holds ~20 complete lines
 * that are mostly one Top loop, and with the decay over every line the term
 * sat at 4 whatever it held (N equal lines sum to 4(1 - 0.5^N), so the Nth,
 * and Karn + Mycosynth Lattice, a 'Lock', added ~0). The ceiling is unchanged. Combos
 * earn nothing under a target bracket of 3 or lower: a counted combo floors
 * the deck above it (@spellcontrol/deck-metrics), so there it is a liability
 * the bracket convergence exists to remove, not a payoff. Nor under a combo
 * setting of 0, the user's "None": a High Perfect Morcant build set to it took
 * Sanguine Bond + Exquisite Blood for two cards that did their own jobs. Under
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

/** Two card sets that differ by at most one card: the same line with a swapped-in piece. */
function sameFamily(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  let shared = 0;
  for (const n of a) if (b.has(n)) shared++;
  return shared >= 1 && shared >= Math.max(a.size, b.size) - 1;
}

export function comboWeight(combo: Pick<DetectedCombo, 'deckCount'>): number {
  return Math.min(1, Math.log10(1 + Math.max(0, combo.deckCount)) / 4);
}

/** Whether a combo earns anything under this target bracket ('all' and 4+ do). */
export function combosCountAtBracket(target: number | string | undefined): boolean {
  return !(typeof target === 'number' && target <= 3);
}

/** Whether a combo earns anything under these settings: the bracket allows it and the user didn't ask for none. */
export function combosEarn(customization: {
  targetBracket?: number | string;
  comboCount?: number;
}): boolean {
  return customization.comboCount !== 0 && combosCountAtBracket(customization.targetBracket);
}

export const combosTerm: TermFn = (deck, ctx) => {
  const combos = ctx.combos ?? [];
  const target = ctx.customization.targetBracket;
  if (!combosCountAtBracket(target)) {
    return { value: 0, summary: `combos earn nothing at target bracket ${target}`, cards: [] };
  }
  if (!combosEarn(ctx.customization)) {
    return { value: 0, summary: 'combos earn nothing with combos set to none', cards: [] };
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
  // Group into families (best weight first; the first of a family is its head).
  const families: Array<{ set: Set<string>; members: typeof complete; f: number }> = [];
  for (const entry of complete) {
    const set = new Set(entry.combo.cards.map((n) => n.toLowerCase()));
    const fam = families.find((x) => sameFamily(x.set, set));
    if (fam) fam.members.push(entry);
    else families.push({ set, members: [entry], f: entry.w });
  }
  // A family is worth its head's weight, topped up by its variants as a noisy-or
  // (redundancy, never a second full line); the decay runs over families.
  for (const fam of families) {
    fam.f = 1 - fam.members.reduce((p, m, i) => (i === 0 ? 1 - m.w : p * (1 - m.w)), 1);
  }
  families.sort((a, b) => b.f - a.f);
  const notes: CardNote[] = [];
  let value = 0;
  families.forEach((fam, i) => {
    const famValue = COMBO_SCALE * fam.f * COMBO_DECAY ** i;
    value += famValue;
    let before = 0;
    fam.members.forEach(({ combo, w }, j) => {
      // The head carries the family's head share; each variant its marginal top-up.
      const after = 1 - (1 - before) * (1 - w);
      const v = COMBO_SCALE * (after - before) * COMBO_DECAY ** i;
      before = after;
      const label = combo.cards.join(' + ');
      for (const name of combo.cards) {
        notes.push({
          name,
          value: v / combo.cards.length,
          note: `piece of ${label} (${combo.deckCount} decks${combo.results[0] ? `: ${combo.results[0]}` : ''}${j ? `; a variant of ${fam.members[0].combo.cards.join(' + ')}` : ''})`,
        });
      }
    });
  });
  return {
    value,
    summary: complete.length
      ? `${complete.length} complete combos in ${families.length} families, best ${families[0].members[0].combo.cards.join(' + ')} (w ${round2(families[0].members[0].w)})`
      : 'no complete combo',
    cards: notes,
  };
};
