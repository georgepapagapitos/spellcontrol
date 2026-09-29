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
 * bounce / board wipes), announced with an iconic real card name. Between
 * your turns it can also attack you or make you discard (E533).
 *
 * Kept deliberately OUT of the game-state reducer: this module only *decides*;
 * effects are expressed as ordinary reducer actions (MOVE_TO_ZONE,
 * ADJUST_LIFE), so every opponent effect is undoable per-move for free.
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
  | {
      kind: 'played';
      card: PlaytestCard;
      /** The turn it was played on. Absent reads as past the first-answer
       *  turn, which is how every event before E533 behaved. */
      turn?: number;
    }
  | { kind: 'turnStart'; turn: number };

export type ResistanceEffect = 'counter' | 'destroy' | 'bounce' | 'wipe' | 'attack' | 'discard';

export interface ResistanceResponse {
  spellName: string;
  message: string;
  effect: ResistanceEffect;
  /** Cards the effect moves: the played card, the wiped board, or the
   *  discarded hand cards. Empty for an attack. */
  targetIds: string[];
  /** Where `targetIds` go. An overloaded Cyclonic Rift sends a wiped board
   *  to hand, and a bounce does too; everything else is the graveyard. */
  to: 'graveyard' | 'hand';
  /** Life lost to an attack; 0 for every other effect. */
  lifeLoss: number;
}

/** What the opponent can see of your side when it decides. */
export interface ResistanceBoard {
  battlefield: ReadonlyArray<{ card: PlaytestCard }>;
  /** Discard picks from here. Absent means an empty hand. */
  hand?: readonly PlaytestCard[];
  /** Scales attack damage to the format: 40 is Commander. Defaults to 40. */
  startingLife?: number;
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
export type ArmedResistanceLevel = Exclude<ResistanceLevel, 'off'>;

/** Difficulty presets — tune here. `standard` is the original, unchanged model. */
export const RESISTANCE_PRESETS: Record<ArmedResistanceLevel, ResistanceConfig> = {
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

/**
 * Pressure between your turns (E533): the chance an attacker gets through or
 * you're made to discard, and how hard an attack hits. Kept apart from
 * `RESISTANCE_PRESETS` so the pinned `standard` preset stays byte-identical.
 */
export interface ResistancePressure {
  attackChance: number;
  discardChance: number;
  /** Multiplies the turn-scaled damage band. */
  attackScale: number;
}

export const RESISTANCE_PRESSURE: Record<ArmedResistanceLevel, ResistancePressure> = {
  casual: { attackChance: 0.25, discardChance: 0.08, attackScale: 0.7 },
  standard: { attackChance: 0.4, discardChance: 0.12, attackScale: 1 },
  ruthless: { attackChance: 0.6, discardChance: 0.2, attackScale: 1.4 },
};

/**
 * The player's own settings, layered over a level's preset (E533). Kept out
 * of `ResistanceConfig` on purpose: the presets are pinned numbers, these are
 * what the player chose. `LEGACY_RESISTANCE_OPTIONS` is the model every game
 * before them ran, so a resumed game plays on unchanged.
 */
export interface ResistanceOptions {
  /** No answer of any kind before this turn. */
  firstTurn: number;
  /** Which kinds of answer are in play. */
  effects: Record<ResistanceEffect, boolean>;
  /** Their answers may be Game Changers: Cyclonic Rift (a bounce, or
   *  overloaded as a wipe to hand) and the free counters. */
  gameChangers: boolean;
}

/** In the order the picker lists them. */
export const RESISTANCE_EFFECTS: readonly ResistanceEffect[] = [
  'counter',
  'destroy',
  'bounce',
  'wipe',
  'attack',
  'discard',
];

export const FIRST_TURN_CHOICES = [1, 2, 3, 4, 5] as const;

/** A new game's options. Turn 3 because a real table rarely holds an answer
 *  up on turns 1 and 2, and a turn-2 Counterspell reads as noise. Game
 *  Changers come from the deck's bracket (`gameChangersForBracket`). */
export const DEFAULT_RESISTANCE_OPTIONS: ResistanceOptions = {
  firstTurn: 3,
  effects: { counter: true, destroy: true, bounce: true, wipe: true, attack: true, discard: true },
  gameChangers: false,
};

/** The model before E533: answers from turn 1 and no attacks or discard. A
 *  snapshot saved without options resumes on this. */
export const LEGACY_RESISTANCE_OPTIONS: ResistanceOptions = {
  firstTurn: 1,
  effects: {
    counter: true,
    destroy: true,
    bounce: true,
    wipe: true,
    attack: false,
    discard: false,
  },
  gameChangers: false,
};

/** The level that fits a deck's bracket (E533): 1 and 2 face Casual, 3
 *  Standard, 4 and 5 Ruthless. `null` when the bracket isn't known. */
export function levelForBracket(bracket: number | null | undefined): ArmedResistanceLevel | null {
  if (bracket == null) return null;
  if (bracket <= 2) return 'casual';
  if (bracket === 3) return 'standard';
  return 'ruthless';
}

/** Game Changers only from bracket 3 up, the line the bracket rules draw. An
 *  unknown bracket reads as off. */
export function gameChangersForBracket(bracket: number | null | undefined): boolean {
  return bracket != null && bracket >= 3;
}

export const RESISTANCE_LEVEL_LABEL: Record<ResistanceLevel, string> = {
  off: 'Off',
  casual: 'Casual',
  standard: 'Standard',
  ruthless: 'Ruthless',
};

/** One-line, plain-language description for the level picker. */
export const RESISTANCE_LEVEL_DESCRIPTION: Record<ResistanceLevel, string> = {
  off: 'You goldfish. Nobody answers.',
  casual: 'An answer now and then, one wipe at most.',
  standard: 'They usually have an answer for your biggest threat.',
  ruthless: 'They almost always have it, and up to 2 wipes a game.',
};

/** Banner/log announcement fired when a level is picked. */
export const RESISTANCE_LEVEL_ANNOUNCE: Record<ResistanceLevel, string> = {
  off: 'Resistance: Off',
  casual: 'Resistance: Casual. An answer now and then, one wipe at most',
  standard: 'Resistance: Standard. Expect answers to your biggest threats and a wipe',
  ruthless: 'Resistance: Ruthless. Expect answers to most threats and up to 2 wipes',
};

/** Picker copy per effect. A line under the label only where the label
 *  doesn't already say what On does (STYLE_GUIDE voice rule 20): the wipe
 *  threshold and when attacks and discard land are not in their names. */
export const RESISTANCE_EFFECT_COPY: Record<ResistanceEffect, { label: string; hint?: string }> = {
  counter: { label: 'Counterspells' },
  destroy: { label: 'Removal' },
  bounce: { label: 'Bounce' },
  wipe: { label: 'Board wipes', hint: 'Once you have 5 nonland permanents out.' },
  attack: { label: 'Attacks', hint: 'Between your turns you lose life, more as the game goes on.' },
  discard: { label: 'Discard', hint: 'Between your turns you discard at random.' },
};

/* ── Iconic real cards, one picked seeded-randomly per response ─────────── */
type SpellEffect = 'counter' | 'destroy' | 'bounce' | 'wipe';

const SPELLS: Record<SpellEffect, readonly string[]> = {
  counter: ['Counterspell', 'Negate', 'Swan Song', "An Offer You Can't Refuse"],
  destroy: ['Swords to Plowshares', 'Doom Blade', 'Beast Within', 'Chaos Warp'],
  bounce: ['Boomerang', 'Into the Roil'],
  wipe: ['Wrath of God', 'Blasphemous Act', 'Damnation', 'Farewell'],
};

const RIFT = 'Cyclonic Rift';

/** Game Changers (the official Commander list), pooled in only when
 *  `options.gameChangers` is on. A Rift picked as a wipe is overloaded. */
const GAME_CHANGER_SPELLS: Record<SpellEffect, readonly string[]> = {
  counter: ['Fierce Guardianship', 'Force of Will'],
  destroy: [],
  bounce: [RIFT],
  wipe: [RIFT],
};

function spellPool(effect: SpellEffect, options: ResistanceOptions): readonly string[] {
  return options.gameChangers
    ? [...SPELLS[effect], ...GAME_CHANGER_SPELLS[effect]]
    : SPELLS[effect];
}

/** Random discard, named for the card that does it. */
const DISCARD_SOURCES: ReadonlyArray<{ name: string; count: number; verb: string }> = [
  { name: 'Hymn to Tourach', count: 2, verb: 'Opponent casts Hymn to Tourach' },
  { name: 'Hypnotic Specter', count: 1, verb: 'Hypnotic Specter connects' },
];

const EFFECT_VERB: Record<'counter' | 'destroy' | 'bounce', string> = {
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

/** "A", "A and B", "A, B and C". */
function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
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

/**
 * Attack damage on `turn`: a band that widens and climbs with the game
 * (turn 3 is 1 to 5, turn 10 is 8 to 12 at Standard in Commander), scaled by
 * the level and by the format's starting life so a 20-life game isn't over by
 * turn 5.
 */
function attackDamage(turn: number, unit: number, scale: number, startingLife: number): number {
  const lo = Math.max(1, turn - 2);
  const hi = turn + 2;
  const raw = lo + Math.floor(unit * (hi - lo + 1));
  return Math.max(1, Math.round(raw * scale * (startingLife / 40)));
}

/* ── Device-local preferences ───────────────────────────────────────────── */
const LAST_LEVEL_KEY = 'spellcontrol:playtest:resistance-level';
const OPTIONS_KEY = 'spellcontrol:playtest:resistance-options';

/** The last non-off level the player picked on this device (defaults to 'standard'). */
export function loadLastResistanceLevel(): ArmedResistanceLevel {
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

/**
 * Accepts any stored shape and returns valid options, falling back field by
 * field to `fallback`. Shared by the device preference and snapshot resume.
 */
export function normalizeResistanceOptions(
  raw: unknown,
  fallback: ResistanceOptions
): ResistanceOptions {
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Partial<Record<keyof ResistanceOptions, unknown>>;
  const turn = r.firstTurn;
  const firstTurn = (FIRST_TURN_CHOICES as readonly unknown[]).includes(turn)
    ? (turn as number)
    : fallback.firstTurn;
  const effects = { ...fallback.effects };
  if (r.effects && typeof r.effects === 'object') {
    for (const e of RESISTANCE_EFFECTS) {
      const v = (r.effects as Record<string, unknown>)[e];
      if (typeof v === 'boolean') effects[e] = v;
    }
  }
  const gameChangers = typeof r.gameChangers === 'boolean' ? r.gameChangers : fallback.gameChangers;
  return { firstTurn, effects, gameChangers };
}

/**
 * The player's timing and answer choices, remembered on this device. Game
 * Changers is not: it follows each deck's bracket, so it's set per game.
 */
export function loadResistanceOptions(gameChangers: boolean): ResistanceOptions {
  let stored: unknown = null;
  try {
    const raw = localStorage.getItem(OPTIONS_KEY);
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    stored = null;
  }
  return { ...normalizeResistanceOptions(stored, DEFAULT_RESISTANCE_OPTIONS), gameChangers };
}

export function saveResistanceOptions(options: ResistanceOptions): void {
  try {
    const { firstTurn, effects } = options;
    localStorage.setItem(OPTIONS_KEY, JSON.stringify({ firstTurn, effects }));
  } catch {
    /* best-effort — storage unavailable/full */
  }
}

/** The short value a collapsed "Answers" group states, e.g. "All 6" or
 *  "No discard" or "4 of 6". */
export function summarizeEffects(effects: Record<ResistanceEffect, boolean>): string {
  const off = RESISTANCE_EFFECTS.filter((e) => !effects[e]);
  if (off.length === 0) return `All ${RESISTANCE_EFFECTS.length}`;
  if (off.length === RESISTANCE_EFFECTS.length) return 'None';
  if (off.length === 1) return `No ${RESISTANCE_EFFECT_COPY[off[0]].label.toLowerCase()}`;
  return `${RESISTANCE_EFFECTS.length - off.length} of ${RESISTANCE_EFFECTS.length}`;
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
 *
 * With `LEGACY_RESISTANCE_OPTIONS` (the default) every roll lands exactly
 * where it did before E533, so a seed replays the same game.
 */
export function resistanceRespond(
  state: ResistanceState,
  event: ResistanceEvent,
  board: ResistanceBoard,
  config: ResistanceConfig,
  options: ResistanceOptions = LEGACY_RESISTANCE_OPTIONS,
  pressure: ResistancePressure = RESISTANCE_PRESSURE.standard
): { state: ResistanceState; response: ResistanceResponse | null } {
  const { effects } = options;
  if (event.kind === 'turnStart') {
    // New player turn: the per-turn response budget resets, and the
    // opponent sizes up the board for a wipe (budgeted per game).
    let next: ResistanceState = { ...state, responsesThisTurn: 0 };
    if (event.turn < options.firstTurn) return { state: next, response: null };

    const targetIds = board.battlefield.filter((b) => isWipeTarget(b.card)).map((b) => b.card.id);
    const wipeEligible =
      effects.wipe &&
      next.wipesUsed < config.wipesPerGame &&
      targetIds.length >= config.wipeMinPermanents;
    if (wipeEligible) {
      const chance = roll(next.seed);
      next = { ...next, seed: chance.seed };
      if (chance.value < config.wipeChance) {
        const spell = pick(spellPool('wipe', options), next.seed);
        next = {
          ...next,
          seed: spell.seed,
          wipesUsed: next.wipesUsed + 1,
          responsesThisTurn: next.responsesThisTurn + 1,
        };
        const overloaded = spell.item === RIFT;
        return {
          state: next,
          response: {
            spellName: spell.item,
            message: overloaded
              ? `Opponent overloads ${RIFT}: your board returns to hand`
              : `Opponent casts ${spell.item}: the board is wiped`,
            effect: 'wipe',
            targetIds,
            to: overloaded ? 'hand' : 'graveyard',
            lifeLoss: 0,
          },
        };
      }
    }

    // No wipe: the opponents' turns may still hurt. One roll decides between
    // an attack, a discard, or nothing; neither spends the budget for
    // answering your plays, since both happened on their turns.
    const hand = board.hand ?? [];
    const attackChance = effects.attack ? pressure.attackChance : 0;
    const discardChance = effects.discard && hand.length > 0 ? pressure.discardChance : 0;
    if (attackChance + discardChance === 0) return { state: next, response: null };
    const between = roll(next.seed);
    next = { ...next, seed: between.seed };
    if (between.value < attackChance) {
      const dmg = roll(next.seed);
      next = { ...next, seed: dmg.seed };
      const lifeLoss = attackDamage(
        event.turn,
        dmg.value,
        pressure.attackScale,
        board.startingLife ?? 40
      );
      return {
        state: next,
        response: {
          spellName: 'Attack',
          message: `Opponent attacks: you lose ${lifeLoss} life`,
          effect: 'attack',
          targetIds: [],
          to: 'graveyard',
          lifeLoss,
        },
      };
    }
    if (between.value < attackChance + discardChance) {
      const source = pick(DISCARD_SOURCES, next.seed);
      next = { ...next, seed: source.seed };
      const pool = [...hand];
      const discarded: PlaytestCard[] = [];
      for (let i = 0; i < Math.min(source.item.count, hand.length); i++) {
        const choice = pick(pool, next.seed);
        next = { ...next, seed: choice.seed };
        discarded.push(choice.item);
        pool.splice(pool.indexOf(choice.item), 1);
      }
      return {
        state: next,
        response: {
          spellName: source.item.name,
          message: `${source.item.verb}: you discard ${listNames(discarded.map((c) => c.name))} at random`,
          effect: 'discard',
          targetIds: discarded.map((c) => c.id),
          to: 'graveyard',
          lifeLoss: 0,
        },
      };
    }
    return { state: next, response: null };
  }

  // 'played' — a card the player just put onto the battlefield.
  const { card } = event;
  if (event.turn !== undefined && event.turn < options.firstTurn) return { state, response: null };
  if (state.responsesThisTurn >= config.maxResponsesPerTurn) return { state, response: null };
  if (isPlaytestLand(card.typeLine) || card.isToken) return { state, response: null };

  // The split among the answers still in play, in the preset's proportions.
  const weights: Array<['counter' | 'destroy' | 'bounce', number]> = [
    ['counter', effects.counter ? config.counterShare : 0],
    ['destroy', effects.destroy ? config.destroyShare : 0],
    ['bounce', effects.bounce ? 1 - config.counterShare - config.destroyShare : 0],
  ];
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  if (total <= 0) return { state, response: null };

  const chance = roll(state.seed);
  let next: ResistanceState = { ...state, seed: chance.seed };
  if (chance.value >= config.responseChance[threatOf(card)]) return { state: next, response: null };

  const effectRoll = roll(next.seed);
  // With all three in play `total` is 1 and this is the original cumulative
  // counter / destroy / bounce split. The fallback is the last answer in
  // play, for a roll that float rounding carries past every bucket.
  const inPlay = weights.filter(([, w]) => w > 0);
  let at = effectRoll.value * total;
  let effect = inPlay[inPlay.length - 1][0];
  for (const [e, w] of inPlay) {
    if (at < w) {
      effect = e;
      break;
    }
    at -= w;
  }
  const spell = pick(spellPool(effect, options), effectRoll.seed);
  next = { ...next, seed: spell.seed, responsesThisTurn: next.responsesThisTurn + 1 };
  return {
    state: next,
    response: {
      spellName: spell.item,
      message: `Opponent casts ${spell.item}: ${card.name} is ${EFFECT_VERB[effect]}`,
      effect,
      targetIds: [card.id],
      to: effect === 'bounce' ? 'hand' : 'graveyard',
      lifeLoss: 0,
    },
  };
}

/* ── Store glue ────────────────────────────────────────────────────────── */

/**
 * Bridge between the playtest store and the resistance brain: given the state
 * before/after a user action, derive the resistance event (if any), let the
 * opponent respond, and apply the response as ordinary reducer actions
 * (counter/destroy/discard → graveyard, bounce → hand, wipe → graveyard or,
 * overloaded, hand; an attack is a life change). Tokens sent to the
 * graveyard vanish per the reducer (rule 704.5d).
 *
 * `applied` lists each response action with the state it ran against, so the
 * store can classify every history entry it pushed for takeback.
 */
export function applyResistance(
  resistanceState: ResistanceState,
  prev: PlaytestState,
  next: PlaytestState,
  action: PlaytestAction,
  config: ResistanceConfig,
  options: ResistanceOptions = LEGACY_RESISTANCE_OPTIONS,
  pressure: ResistancePressure = RESISTANCE_PRESSURE.standard
): {
  state: PlaytestState;
  resistanceState: ResistanceState;
  message: string | null;
  applied: Array<{ before: PlaytestState; action: PlaytestAction }>;
} {
  let event: ResistanceEvent | null = null;
  if (action.type === 'MOVE_TO_BATTLEFIELD') {
    // Only hand/command → battlefield counts as "playing" a spell; battlefield
    // repositions and graveyard/exile/library retrievals don't draw responses.
    const played =
      prev.zones.hand.find((c) => c.id === action.cardId) ??
      prev.zones.command.find((c) => c.id === action.cardId);
    if (played) event = { kind: 'played', card: played, turn: next.turn };
  } else if (action.type === 'NEXT_TURN') {
    event = { kind: 'turnStart', turn: next.turn };
  }
  if (!event) return { state: next, resistanceState, message: null, applied: [] };

  const result = resistanceRespond(
    resistanceState,
    event,
    { battlefield: next.battlefield, hand: next.zones.hand, startingLife: next.startingLife },
    config,
    options,
    pressure
  );
  if (!result.response)
    return { state: next, resistanceState: result.state, message: null, applied: [] };

  const { targetIds, to, lifeLoss, message } = result.response;
  const actions: PlaytestAction[] =
    lifeLoss > 0
      ? [{ type: 'ADJUST_LIFE', delta: -lifeLoss }]
      : targetIds.map((cardId) => ({ type: 'MOVE_TO_ZONE', cardId, to }));
  let state = next;
  const applied: Array<{ before: PlaytestState; action: PlaytestAction }> = [];
  for (const a of actions) {
    applied.push({ before: state, action: a });
    state = applyAction(state, a);
  }
  return { state, resistanceState: result.state, message, applied };
}
