/**
 * What a goal asks of the goldfish (see `simulateGoal` in `./engine.ts`): which
 * cards are pieces, tutors, ramp or draw, what to cast first, what casting a
 * draw spell or a tutor does to the hand and library, and when a run is done.
 *
 * The engine owns the game; this owns the goal. It reaches the game through
 * `Play`, a live view (getters on the engine's own state), so nothing here is
 * copied and the engine's loop stays one loop.
 */

import { canPay } from './cost';
import type { DrawEffect, ManaCard, ManaGoal, ManaMask } from './types';

/** Tagged `cardDraw` but not readable from its text (Rhystic Study, X draws): two cards, the clock's long-standing flat reading. */
export const UNREAD_DRAW: DrawEffect = {
  draw: 2,
  putBack: 0,
  discard: 0,
  look: 0,
  take: 0,
  scry: 0,
  scryFirst: false,
  perTurn: 0,
};

/** Cast priority by class (see `GoalPlay.classOf`): finishing beats developing once the deck is one piece from done. */
const FINISHING = [1, 2, 0, 3] as const;
const DEVELOPING = [0, 3, 1, 2] as const;

/** The engine's live game state, as this module needs it. */
export interface Play {
  readonly hand: number[];
  /** Library order from `ptr`; bottomed cards sit at the end. */
  readonly order: number[];
  ptr: number;
  readonly libCount: Int32Array;
  /** Lands on the battlefield. */
  readonly landsInPlay: number;
  addHandPips(id: number, sign: 1 | -1): void;
  removeFromLibrary(id: number): void;
}

interface Option {
  ids: number[];
  need: number;
}

export interface GoalPlay {
  /** Games end on turn 1: a zero-need option (every piece in the command zone). */
  readonly immediate: boolean;
  isPiece(id: number): boolean;
  /** A land of the deck entered the battlefield: a land that is itself a piece (Phyrexian Tower) counts as soon as it is down. */
  played(id: number): void;
  /** A new game: nothing cast, no engines. */
  reset(): void;
  /** Extra draws from cast engines (Phyrexian Arena), taken after the turn's own draw. */
  drawEngines(): void;
  /** Hand index of the next card to cast with this mana, or -1. */
  pick(work: ManaMask[]): number;
  /** The card at `id` was cast: count a piece, fetch for a tutor, draw. */
  cast(id: number): void;
  /** Some option is fully cast. */
  done(): boolean;
}

/** Null when no option's pieces are in the library. */
export function createGoalPlay(
  goal: ManaGoal,
  cards: readonly ManaCard[],
  idByName: ReadonlyMap<string, number>,
  play: Play
): GoalPlay | null {
  const options: Option[] = [];
  for (const o of goal.options) {
    const ids = Array.from(new Set(o.names))
      .map((n) => idByName.get(n))
      .filter((id): id is number => id !== undefined);
    if (o.need <= 0 || ids.length >= o.need) options.push({ ids, need: o.need });
  }
  if (options.length === 0) return null;
  const immediate = options.some((o) => o.need <= 0);

  const pieceIds = new Set<number>();
  for (const o of options) for (const id of o.ids) pieceIds.add(id);
  // A tutor that is itself a piece stays a piece.
  const tutorIds = new Set<number>();
  for (const n of goal.tutors ?? []) {
    const id = idByName.get(n);
    if (id !== undefined && !pieceIds.has(id)) tutorIds.add(id);
  }
  /** What casting a card does for the hand: read from its text, else the tagger's cardDraw role. */
  const drawOf = cards.map(
    (c) => c.draw ?? (c.sim.role === 'cardDraw' && !c.landCard ? UNREAD_DRAW : null)
  );
  const drawsCards = drawOf.map((e) => e !== null && (e.draw > 0 || e.take > 0 || e.perTurn > 0));
  const castPiece = new Uint8Array(cards.length);
  const cheapest = [-1, -1, -1, -1];
  let engineDraws = 0;

  const mv = (id: number): number => cards[id].cost?.mv ?? 0;
  const missing = (o: Option): number => {
    let n = o.need;
    for (const id of o.ids) if (castPiece[id]) n--;
    return n;
  };
  const closest = (): number => {
    let best = Infinity;
    for (const o of options) best = Math.min(best, missing(o));
    return best;
  };

  /** Cast class: 0 ramp, 1 needed piece, 2 tutor, 3 draw, -1 not worth casting. */
  const classOf = (id: number): number => {
    const c = cards[id];
    if (c.landCard) return -1;
    if (pieceIds.has(id)) return castPiece[id] ? -1 : 1;
    if (tutorIds.has(id)) return 2;
    if (c.ramp) return 0;
    return drawsCards[id] ? 3 : -1;
  };

  /** How much the goal wants this card in hand: pieces, then ramp and draw, lands while short. */
  const wanted = (id: number): number => {
    const c = cards[id];
    if (pieceIds.has(id)) return castPiece[id] || play.hand.includes(id) ? 0 : 5;
    if (tutorIds.has(id)) return closest() > 0 ? 3.5 : 0;
    if (c.landCard) {
      let have = play.landsInPlay;
      for (const h of play.hand) if (cards[h].landCard) have++;
      return have < 6 ? 2.5 : 0.5;
    }
    if (c.ramp) return 3;
    return drawsCards[id] ? 2.8 : 0;
  };

  const drawOne = (): void => {
    if (play.ptr >= play.order.length) return;
    const id = play.order[play.ptr++];
    play.libCount[id]--;
    play.hand.push(id);
    play.addHandPips(id, 1);
  };

  /** Hand index of the card the goal wants least (priciest on a tie). */
  const leastWanted = (): number => {
    let worst = -1;
    let worstV = Infinity;
    for (let h = 0; h < play.hand.length; h++) {
      const v = wanted(play.hand[h]);
      if (v < worstV || (v === worstV && mv(play.hand[h]) > mv(play.hand[worst]))) {
        worstV = v;
        worst = h;
      }
    }
    return worst;
  };

  /** Keep the top cards the goal wants; the rest go to the bottom. */
  const scry = (n: number): void => {
    const w = Math.min(n, play.order.length - play.ptr);
    if (w <= 0) return;
    const window = play.order.slice(play.ptr, play.ptr + w);
    play.order.splice(play.ptr, w, ...window.filter((id) => wanted(id) > 0.5));
    play.order.push(...window.filter((id) => wanted(id) <= 0.5));
  };

  const applyDraw = (e: DrawEffect): void => {
    if (e.scryFirst) scry(e.scry);
    if (e.look > 0) {
      const w = Math.min(e.look, play.order.length - play.ptr);
      const window = play.order.slice(play.ptr, play.ptr + w);
      const take = Math.min(w, e.take > 0 ? e.take : e.draw);
      const ranked = window
        .map((id, i) => ({ i, v: wanted(id), ok: !e.landOnly || cards[id].landCard }))
        .filter((r) => r.ok)
        .sort((a, b) => b.v - a.v || a.i - b.i)
        .slice(0, take);
      const taken = new Set(ranked.map((r) => r.i));
      const rest = window.filter((_, i) => !taken.has(i));
      // A look-and-take (Dig) sends the rest to the bottom; a look-then-draw (Ponder) leaves them on top.
      play.order.splice(play.ptr, w, ...(e.take > 0 ? [] : rest));
      if (e.take > 0) play.order.push(...rest);
      for (const r of ranked) {
        const id = window[r.i];
        play.libCount[id]--;
        play.hand.push(id);
        play.addHandPips(id, 1);
      }
    } else {
      for (let d = 0; d < e.draw; d++) drawOne();
    }
    for (let k = 0; k < e.putBack && play.hand.length > 0; k++) {
      const h = leastWanted();
      const id = play.hand[h];
      play.hand.splice(h, 1);
      play.addHandPips(id, -1);
      play.order.splice(play.ptr, 0, id);
      play.libCount[id]++;
    }
    for (let k = 0; k < e.discard && play.hand.length > 0; k++) {
      const h = leastWanted();
      play.addHandPips(play.hand[h], -1);
      play.hand.splice(h, 1);
    }
    if (!e.scryFirst) scry(e.scry);
  };

  /** A cast tutor fetches the cheapest missing piece of the option closest to done into HAND. */
  const fetchPiece = (): void => {
    let target: Option | null = null;
    for (const o of options)
      if (missing(o) > 0 && (!target || missing(o) < missing(target))) target = o;
    let want = -1;
    for (const id of target?.ids ?? []) {
      if (castPiece[id] || play.hand.includes(id) || play.libCount[id] <= 0) continue;
      if (want < 0 || mv(id) < mv(want)) want = id;
    }
    if (want < 0) return;
    play.removeFromLibrary(want);
    play.hand.push(want);
    play.addHandPips(want, 1);
  };

  return {
    immediate,
    isPiece: (id) => pieceIds.has(id),
    played(id) {
      if (pieceIds.has(id) && cards[id].landCard) castPiece[id] = 1;
    },
    reset() {
      castPiece.fill(0);
      engineDraws = 0;
    },
    drawEngines() {
      for (let d = 0; d < engineDraws; d++) drawOne();
    },
    pick(work) {
      // Greedy sequencing: ramp and draw before pieces unless the deck is one
      // piece from done, then finishing beats developing. The cheapest card of
      // each class (the first on a tie) is the candidate.
      const priority = closest() <= 1 ? FINISHING : DEVELOPING;
      cheapest.fill(-1);
      for (let h = 0; h < play.hand.length; h++) {
        const id = play.hand[h];
        const cls = classOf(id);
        if (cls < 0) continue;
        const cost = cards[id].cost;
        // A piece with no mana cost is free; nothing else without one is cast.
        if (cost ? !canPay(cost, work) : cls !== 1) continue;
        const best = cheapest[cls];
        if (best < 0 || mv(id) < mv(play.hand[best])) cheapest[cls] = h;
      }
      for (const want of priority) if (cheapest[want] >= 0) return cheapest[want];
      return -1;
    },
    cast(id) {
      if (pieceIds.has(id)) castPiece[id] = 1;
      else if (tutorIds.has(id)) fetchPiece();
      else if (drawOf[id]) {
        applyDraw(drawOf[id] as DrawEffect);
        engineDraws += (drawOf[id] as DrawEffect).perTurn;
      }
    },
    done: () => closest() <= 0,
  };
}
