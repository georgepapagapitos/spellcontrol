/**
 * The whole-deck objective's judge for the plans that choose their own moves
 * (E540 S9): the upgrade plan (`planUpgrades`). The Cuts lane already scores each row with `judgeMove`
 * (the Cuts lane scorer); the plans used to rank by play-rate and money alone,
 * so a plan could cut a protected card (a staple, a combo piece, a tutor, a
 * role at its floor) or swap in a card the deck scores worse with.
 *
 * `createPlanJudge` wraps `judgeMove` for ONE saved deck. It judges each move
 * against the deck AS THE PLAN HAS LEFT IT (the picks before it applied), the
 * way a person following the plan row by row meets them, so two picks that
 * each look fine alone but together empty a role are not both offered. The
 * protection set is the objective's own (`buildCoachObjective` hands the
 * shared Coach protections to the context), so a plan refuses the same cuts the
 * Cuts lane does.
 *
 * Moves are judged with the FAST terms (all but the goldfish mana and winline
 * simulations), as `scoreCoachMoves` does for every row before its full read:
 * a plan judges hundreds of candidate moves and the goldfish costs a game each.
 *
 * A card the cache cannot resolve, or a cut that is not in the deck, is
 * `unscored`: the plan keeps its own rule for it, never a guess.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { frontFaceName } from '@/lib/cards/card-text';
import { normalizeCardName } from '@/deck-builder/services/deckBuilder/cardIdentity';
import {
  judgeMove,
  type MoveJudgement,
} from '@/deck-builder/services/deckBuilder/deckObjective/judge';
import { protectedCards } from '@/deck-builder/services/deckBuilder/deckObjective/protections';
import type {
  ObjectiveContext,
  ObjectiveDeck,
} from '@/deck-builder/services/deckBuilder/deckObjective/types';
import type { CoachObjectiveResult } from './coach-objective';

/** A move the plan has already taken: the card in, and the card out (null: an open slot). */
export interface PlanPick {
  add: string;
  /** The card itself, when the plan holds it (Fill's generated cards); else it is resolved by name. */
  addCard?: ScryfallCard;
  cut: string | null;
}

export type PlanVerdict =
  | { status: 'ok'; delta: number }
  | { status: 'refused'; delta: number; reason: string }
  | { status: 'unscored' };

/** What adding a card to the deck costs it (Fill's question). */
export type LossVerdict =
  | { loss: false }
  | { loss: null }
  | {
      loss: true;
      reason: string;
      /** A hard rule the deck holds is broken (owned-only, bracket, Game Changer limit, banned, colors). */
      hard: boolean;
      /** The protection set holds the card (a staple, Game Changer, combo piece, tutor, survival piece...). */
      premium: boolean;
    };

export interface PlanJudge {
  /**
   * The move (`add` in, `cut` out, or an open slot when null) judged against
   * the deck with `prior` applied. `ok` is the objective's own acceptance: a
   * gain past its margin, inside the trust region, no hard rule worse, nothing
   * the protection set holds.
   */
  verdict(
    add: { name: string; card?: ScryfallCard },
    cut: string | null,
    prior: readonly PlanPick[]
  ): PlanVerdict;
  /**
   * Whether a card may be added to the deck with `prior` applied without making
   * it worse: Fill's rule, where the deck is short and a small gain still beats
   * an empty slot. A loss says whether it is a hard rule break and whether the
   * card is premium, because Fill declines a premium card only for a hard break.
   */
  loss(add: { name: string; card?: ScryfallCard }, prior: readonly PlanPick[]): LossVerdict;
}

const keyOf = (name: string): string => normalizeCardName(frontFaceName(name));

/** A judge for the saved deck, or null when the deck cannot be scored (the plan keeps its own rules). */
export function createPlanJudge(
  objective: CoachObjectiveResult,
  resolve: (name: string) => ScryfallCard | undefined
): PlanJudge | null {
  if (!objective.ok) return null;
  const { deck, ctx } = objective;
  const fastCtx: ObjectiveContext = { ...ctx, weights: { ...ctx.weights, mana: 0, winline: 0 } };
  const cardOf = (name: string, carried?: ScryfallCard): ScryfallCard | undefined => {
    const c = carried?.type_line ? carried : resolve(name);
    return c?.type_line ? c : undefined;
  };

  // The deck after the picks before this one; memoized on the pick list's identity by content.
  let memoKey = '';
  let memoDeck: ObjectiveDeck = deck;
  const deckAfter = (prior: readonly PlanPick[]): ObjectiveDeck => {
    const k = prior.map((p) => `${p.add}>${p.cut ?? ''}`).join('|');
    if (k === memoKey) return memoDeck;
    let cards = [...deck.cards];
    for (const p of prior) {
      if (p.cut) {
        const i = cards.findIndex((c) => keyOf(c.name) === keyOf(p.cut!));
        if (i >= 0) cards.splice(i, 1);
      }
      const add = cardOf(p.add, p.addCard);
      if (add) cards = [...cards, add];
    }
    memoKey = k;
    memoDeck = { commanders: deck.commanders, cards };
    return memoDeck;
  };

  const judged = (
    add: { name: string; card?: ScryfallCard },
    cut: string | null,
    prior: readonly PlanPick[]
  ): MoveJudgement | null => {
    const incoming = cardOf(add.name, add.card);
    if (!incoming) return null;
    const now = deckAfter(prior);
    let out: string[] = [];
    if (cut) {
      const held = now.cards.find((c) => keyOf(c.name) === keyOf(cut));
      if (!held) return null;
      out = [held.name];
    }
    try {
      return judgeMove(now, { out, in: [incoming] }, fastCtx, cut ? {} : { partial: true });
    } catch {
      return null;
    }
  };

  return {
    loss(add, prior) {
      const j = judged(add, null, prior);
      if (!j) return { loss: null };
      // Refused for its margin alone is no loss: the slot is open and a small gain beats none.
      if (j.accepted || (j.delta >= 0 && /^gains /.test(j.refusal ?? ''))) return { loss: false };
      const incoming = cardOf(add.name, add.card)!;
      const held = protectedCards(
        { ...deckAfter(prior), cards: [...deckAfter(prior).cards, incoming] },
        ctx
      );
      return {
        loss: true,
        reason: j.refusal ?? 'scores worse',
        // A partial owned share is read to the card, but a build lands within a few points of it: not a hard rule.
        hard: j.worsened.some((v) => v.check !== 'owned-share'),
        premium: held.has(incoming.name),
      };
    },
    verdict(add, cut, prior) {
      const j = judged(add, cut, prior);
      if (!j) return { status: 'unscored' };
      return j.accepted
        ? { status: 'ok', delta: j.delta }
        : { status: 'refused', delta: j.delta, reason: j.refusal ?? 'not an upgrade' };
    },
  };
}
