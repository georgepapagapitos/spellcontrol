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
 * bounce / board wipes), announced with an iconic real card name.
 *
 * Kept deliberately OUT of the game-state reducer: this module only *decides*;
 * effects are expressed as ordinary reducer actions (MOVE_TO_ZONE), so every
 * opponent effect is undoable per-move for free.
 *
 * All randomness runs through mulberry32/nextSeed, mirroring the reducer's
 * rngSeed discipline — every roll advances the seed carried in
 * `ResistanceState`, so a given seed + config always produces the same
 * responses (E142: intensity is a `ResistanceConfig`, not a module constant).
 */

export interface ResistanceState {
  seed: number;
  /** How many board wipes this game has used so far (budget: config.wipesPerGame). */
  wipesUsed: number;
  /** Responses spent this player turn (budget: config.maxResponsesPerTurn); reset on turnStart. */
  responsesThisTurn: number;
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

export interface ResistanceConfig {
  /** Response chance by threat level of the played card. */
  responseChance: { high: number; medium: number; low: number };
  /** Cumulative effect split among a response: counter, then destroy, then bounce (remainder). */
  counterShare: number;
  destroyShare: number;
  /** Board wipe: checked at every eligible turn start until the game's wipe budget is spent. */
  wipeChance: number;
  wipeMinPermanents: number;
  wipesPerGame: number;
  maxResponsesPerTurn: number;
}

export const RESISTANCE_LEVELS = ['off', 'casual', 'standard', 'ruthless'] as const;
export type ResistanceLevel = (typeof RESISTANCE_LEVELS)[number];

/** Difficulty presets — tune here. `standard` is the original, unchanged model. */
export const RESISTANCE_PRESETS: Record<Exclude<ResistanceLevel, 'off'>, ResistanceConfig> = {
  casual: {
    responseChance: { high: 0.225, medium: 0.15, low: 0.06 },
    counterShare: 0.5,
    destroyShare: 0.35,
    wipeChance: 0.15,
    wipeMinPermanents: 5,
    wipesPerGame: 1,
    maxResponsesPerTurn: 1,
  },
  standard: {
    responseChance: { high: 0.45, medium: 0.3, low: 0.12 },
    counterShare: 0.5,
    destroyShare: 0.35,
    wipeChance: 0.25,
    wipeMinPermanents: 5,
    wipesPerGame: 1,
    maxResponsesPerTurn: 1,
  },
  ruthless: {
    responseChance: { high: 0.9, medium: 0.6, low: 0.25 },
    counterShare: 0.5,
    destroyShare: 0.35,
    wipeChance: 0.4,
    wipeMinPermanents: 5,
    wipesPerGame: 2,
    maxResponsesPerTurn: 2,
  },
};

export const RESISTANCE_LEVEL_LABEL: Record<ResistanceLevel, string> = {
  off: 'Off',
  casual: 'Casual',
  standard: 'Standard',
  ruthless: 'Ruthless',
};

/** One-line, plain-language description for the level picker. */
export const RESISTANCE_LEVEL_DESCRIPTION: Record<ResistanceLevel, string> = {
  off: 'No simulated opponent.',
  casual: 'Light pressure — occasional interaction, a rare wipe.',
  standard: 'Assume they usually have an answer. The classic experience.',
  ruthless: 'They always have the answer. 2 wipes per game.',
};

/** Banner/log announcement fired when a level is picked. */
export const RESISTANCE_LEVEL_ANNOUNCE: Record<ResistanceLevel, string> = {
  off: 'Resistance: Off',
  casual: 'Resistance: Casual — occasional interaction, a rare wipe',
  standard: 'Resistance: Standard — expect occasional counters, removal, and a board wipe',
  ruthless: 'Resistance: Ruthless — expect counters, removal, and up to 2 board wipes',
};

/* ── Iconic real cards, one picked seeded-randomly per response ─────────── */
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

/* ── Device-local preference: last non-off level picked ─────────────────── */
const LAST_LEVEL_KEY = 'spellcontrol:playtest:resistance-level';

/** The last non-off level the player picked on this device (defaults to 'standard'). */
export function loadLastResistanceLevel(): Exclude<ResistanceLevel, 'off'> {
  try {
    const raw = localStorage.getItem(LAST_LEVEL_KEY);
    return raw === 'casual' || raw === 'standard' || raw === 'ruthless' ? raw : 'standard';
  } catch {
    return 'standard';
  }
}

export function saveLastResistanceLevel(level: ResistanceLevel): void {
  if (level === 'off') return;
  try {
    localStorage.setItem(LAST_LEVEL_KEY, level);
  } catch {
    /* best-effort — storage unavailable/full */
  }
}

/* ── Public API ────────────────────────────────────────────────────────── */

export function createResistanceState(seed?: number): ResistanceState {
  return {
    seed: (seed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0,
    wipesUsed: 0,
    responsesThisTurn: 0,
  };
}

/**
 * Decide whether the opponent responds to `event`. Pure: returns the advanced
 * resistance state and an optional response — it never touches game state.
 */
export function resistanceRespond(
  state: ResistanceState,
  event: ResistanceEvent,
  board: { battlefield: ReadonlyArray<{ card: PlaytestCard }> },
  config: ResistanceConfig
): { state: ResistanceState; response: ResistanceResponse | null } {
  if (event.kind === 'turnStart') {
    // New player turn: the per-turn response budget resets, and the
    // opponent sizes up the board for a wipe (budgeted per game).
    let next: ResistanceState = { ...state, responsesThisTurn: 0 };
    const targetIds = board.battlefield.filter((b) => isWipeTarget(b.card)).map((b) => b.card.id);
    if (next.wipesUsed >= config.wipesPerGame || targetIds.length < config.wipeMinPermanents) {
      return { state: next, response: null };
    }
    const chance = roll(next.seed);
    next = { ...next, seed: chance.seed };
    if (chance.value >= config.wipeChance) return { state: next, response: null };
    const spell = pick(SPELLS.wipe, next.seed);
    next = {
      ...next,
      seed: spell.seed,
      wipesUsed: next.wipesUsed + 1,
      responsesThisTurn: next.responsesThisTurn + 1,
    };
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
  if (state.responsesThisTurn >= config.maxResponsesPerTurn) return { state, response: null };
  if (isPlaytestLand(card.typeLine) || card.isToken) return { state, response: null };

  const chance = roll(state.seed);
  let next: ResistanceState = { ...state, seed: chance.seed };
  if (chance.value >= config.responseChance[threatOf(card)]) return { state: next, response: null };

  const effectRoll = roll(next.seed);
  const effect: ResistanceResponse['effect'] =
    effectRoll.value < config.counterShare
      ? 'counter'
      : effectRoll.value < config.counterShare + config.destroyShare
        ? 'destroy'
        : 'bounce';
  const spell = pick(SPELLS[effect], effectRoll.seed);
  next = { ...next, seed: spell.seed, responsesThisTurn: next.responsesThisTurn + 1 };
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
  action: PlaytestAction,
  config: ResistanceConfig
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

  const result = resistanceRespond(
    resistanceState,
    event,
    { battlefield: next.battlefield },
    config
  );
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
