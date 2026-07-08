import {
  applyAction,
  type PlaytestAction,
  type PlaytestCard,
  type PlaytestState,
} from '@/lib/playtest';
import { mulberry32, nextSeed } from '@/lib/playtest/rng';
import { isPlaytestLand } from './zones';

/**
 * "Resistance" mode — a tiny simulated opponent for the solo playtester
 * (BlueprintMTG-inspired). It watches the player's plays and turn passes and
 * occasionally responds with popular interaction (counter / spot removal /
 * bounce / one board wipe per game), announced with an iconic real card name.
 *
 * Kept deliberately OUT of the game-state reducer: this module only *decides*;
 * effects are expressed as ordinary reducer actions (MOVE_TO_ZONE), so every
 * opponent effect is undoable per-move for free.
 *
 * All randomness runs through mulberry32/nextSeed, mirroring the reducer's
 * rngSeed discipline — every roll advances the seed carried in
 * `ResistanceState`, so a given seed always produces the same responses.
 */

export interface ResistanceState {
  seed: number;
  /** The board wipe is once per game. */
  wipeUsed: boolean;
  /** At most one response per player turn; reset on turnStart. */
  respondedThisTurn: boolean;
}

export type ResistanceEvent =
  | { kind: 'played'; card: PlaytestCard }
  | { kind: 'turnStart'; turn: number };

export interface ResistanceResponse {
  spellName: string;
  message: string;
  effect: 'counter' | 'destroy' | 'bounce' | 'wipe';
  targetIds: string[];
}

/* ── Decision model (documented constants — tune here) ─────────────────── */

/** Response chance by threat level of the played card. */
const RESPONSE_CHANCE = { high: 0.45, medium: 0.3, low: 0.12 } as const;

/** Given a response, cumulative effect split: counter 50%, destroy 35%, bounce 15%. */
const COUNTER_SHARE = 0.5;
const DESTROY_SHARE = 0.35;

/** Board wipe: once per game, checked at each turn start. */
const WIPE_CHANCE = 0.25;
const WIPE_MIN_PERMANENTS = 5;

/** Iconic real cards, one picked seeded-randomly per response. */
const SPELLS: Record<ResistanceResponse['effect'], readonly string[]> = {
  counter: ['Counterspell', 'Negate', 'Swan Song', "An Offer You Can't Refuse"],
  destroy: ['Swords to Plowshares', 'Doom Blade', 'Beast Within', 'Chaos Warp'],
  bounce: ['Cyclonic Rift', 'Boomerang'],
  wipe: ['Wrath of God', 'Blasphemous Act', 'Damnation', 'Farewell'],
};

const EFFECT_VERB: Record<Exclude<ResistanceResponse['effect'], 'wipe'>, string> = {
  counter: 'countered',
  destroy: 'destroyed',
  bounce: 'returned to hand',
};

/* ── Helpers ───────────────────────────────────────────────────────────── */

/** One seeded roll in [0, 1); returns the advanced seed alongside the value. */
function roll(seed: number): { value: number; seed: number } {
  return { value: mulberry32(seed)(), seed: nextSeed(seed) };
}

function pick<T>(items: readonly T[], seed: number): { item: T; seed: number } {
  const r = roll(seed);
  return { item: items[Math.floor(r.value * items.length)], seed: r.seed };
}

type Threat = 'high' | 'medium' | 'low';

/**
 * Threat score from mana value (>=6 high, 4-5 medium, <=3 / unknown low),
 * bumped one tier for planeswalkers and legendary creatures.
 */
function threatOf(card: PlaytestCard): Threat {
  const mv = card.manaValue ?? 0;
  let threat: Threat = mv >= 6 ? 'high' : mv >= 4 ? 'medium' : 'low';
  const t = (card.typeLine ?? '').toLowerCase();
  const scary = t.includes('planeswalker') || (t.includes('legendary') && t.includes('creature'));
  if (scary && threat !== 'high') threat = threat === 'medium' ? 'high' : 'medium';
  return threat;
}

/** Wipes hit every non-land, non-token battlefield card (unknown types included). */
function isWipeTarget(card: PlaytestCard): boolean {
  return !isPlaytestLand(card.typeLine) && !card.isToken;
}

/* ── Public API ────────────────────────────────────────────────────────── */

export function createResistanceState(seed?: number): ResistanceState {
  return {
    seed: (seed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0,
    wipeUsed: false,
    respondedThisTurn: false,
  };
}

/**
 * Decide whether the opponent responds to `event`. Pure: returns the advanced
 * resistance state and an optional response — it never touches game state.
 */
export function resistanceRespond(
  state: ResistanceState,
  event: ResistanceEvent,
  board: { battlefield: ReadonlyArray<{ card: PlaytestCard }> }
): { state: ResistanceState; response: ResistanceResponse | null } {
  if (event.kind === 'turnStart') {
    // New player turn: the "one response per turn" budget resets, and the
    // opponent sizes up the board for its one-per-game wipe.
    let next: ResistanceState = { ...state, respondedThisTurn: false };
    const targetIds = board.battlefield.filter((b) => isWipeTarget(b.card)).map((b) => b.card.id);
    if (next.wipeUsed || targetIds.length < WIPE_MIN_PERMANENTS) {
      return { state: next, response: null };
    }
    const chance = roll(next.seed);
    next = { ...next, seed: chance.seed };
    if (chance.value >= WIPE_CHANCE) return { state: next, response: null };
    const spell = pick(SPELLS.wipe, next.seed);
    next = { ...next, seed: spell.seed, wipeUsed: true, respondedThisTurn: true };
    return {
      state: next,
      response: {
        spellName: spell.item,
        message: `Opponent casts ${spell.item} — the board is wiped`,
        effect: 'wipe',
        targetIds,
      },
    };
  }

  // 'played' — a card the player just put onto the battlefield.
  const { card } = event;
  if (state.respondedThisTurn) return { state, response: null };
  if (isPlaytestLand(card.typeLine) || card.isToken) return { state, response: null };

  const chance = roll(state.seed);
  let next: ResistanceState = { ...state, seed: chance.seed };
  if (chance.value >= RESPONSE_CHANCE[threatOf(card)]) return { state: next, response: null };

  const effectRoll = roll(next.seed);
  const effect: ResistanceResponse['effect'] =
    effectRoll.value < COUNTER_SHARE
      ? 'counter'
      : effectRoll.value < COUNTER_SHARE + DESTROY_SHARE
        ? 'destroy'
        : 'bounce';
  const spell = pick(SPELLS[effect], effectRoll.seed);
  next = { ...next, seed: spell.seed, respondedThisTurn: true };
  return {
    state: next,
    response: {
      spellName: spell.item,
      message: `Opponent casts ${spell.item} — ${card.name} is ${EFFECT_VERB[effect]}`,
      effect,
      targetIds: [card.id],
    },
  };
}

/* ── Store glue ────────────────────────────────────────────────────────── */

/**
 * Bridge between the playtest store and the resistance brain: given the state
 * before/after a user action, derive the resistance event (if any), let the
 * opponent respond, and apply the response as ordinary reducer actions
 * (counter/destroy → graveyard, bounce → hand, wipe → graveyard for every
 * target). Tokens sent to the graveyard vanish per the reducer (rule 704.5d).
 */
export function applyResistance(
  resistanceState: ResistanceState,
  prev: PlaytestState,
  next: PlaytestState,
  action: PlaytestAction
): { state: PlaytestState; resistanceState: ResistanceState; message: string | null } {
  let event: ResistanceEvent | null = null;
  if (action.type === 'MOVE_TO_BATTLEFIELD') {
    // Only hand/command → battlefield counts as "playing" a spell; battlefield
    // repositions and graveyard/exile/library retrievals don't draw responses.
    const played =
      prev.zones.hand.find((c) => c.id === action.cardId) ??
      prev.zones.command.find((c) => c.id === action.cardId);
    if (played) event = { kind: 'played', card: played };
  } else if (action.type === 'NEXT_TURN') {
    event = { kind: 'turnStart', turn: next.turn };
  }
  if (!event) return { state: next, resistanceState, message: null };

  const result = resistanceRespond(resistanceState, event, { battlefield: next.battlefield });
  if (!result.response) return { state: next, resistanceState: result.state, message: null };

  const { effect, targetIds, message } = result.response;
  let state = next;
  for (const cardId of targetIds) {
    state = applyAction(state, {
      type: 'MOVE_TO_ZONE',
      cardId,
      to: effect === 'bounce' ? 'hand' : 'graveyard',
    });
  }
  return { state, resistanceState: result.state, message };
}
