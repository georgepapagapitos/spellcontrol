import { mulberry32, nextSeed, shuffle } from './rng';
import type {
  BattlefieldCard,
  PlaytestAction,
  PlaytestCard,
  PlaytestInit,
  PlaytestState,
  Zone,
} from './types';

const DEFAULT_OPENING_HAND = 7;
const MAX_UNDO_STACK = 50;
const ZONES: Zone[] = ['library', 'hand', 'graveyard', 'exile', 'command'];

function emptyZones(): Record<Zone, PlaytestCard[]> {
  return { library: [], hand: [], graveyard: [], exile: [], command: [] };
}

export function createPlaytestState(init: PlaytestInit): PlaytestState {
  const seed = init.seed ?? Math.floor(Math.random() * 0xffffffff) >>> 0;
  const shuffled = shuffle(init.library, mulberry32(seed));
  const handSize = Math.min(init.openingHandSize ?? DEFAULT_OPENING_HAND, shuffled.length);
  const hand = shuffled.slice(0, handSize);
  const library = shuffled.slice(handSize);
  return {
    zones: {
      ...emptyZones(),
      library,
      hand,
      command: init.command ?? [],
    },
    battlefield: [],
    rngSeed: nextSeed(seed),
    turn: 1,
    past: [],
  };
}

/** Snapshot the present (sans `past`) and push it onto the undo stack. */
function snapshot(state: PlaytestState): Omit<PlaytestState, 'past'> {
  return {
    zones: {
      library: state.zones.library.slice(),
      hand: state.zones.hand.slice(),
      graveyard: state.zones.graveyard.slice(),
      exile: state.zones.exile.slice(),
      command: state.zones.command.slice(),
    },
    battlefield: state.battlefield.map((b) => ({ ...b, counters: { ...b.counters } })),
    rngSeed: state.rngSeed,
    turn: state.turn,
  };
}

function withHistory(prev: PlaytestState, next: Omit<PlaytestState, 'past'>): PlaytestState {
  const past = [snapshot(prev), ...prev.past].slice(0, MAX_UNDO_STACK);
  return { ...next, past };
}

interface Locator {
  source: 'zone' | 'battlefield';
  zone?: Zone;
  index: number;
}

/** Find a card by instance id across all zones + battlefield. */
function locate(state: PlaytestState, cardId: string): Locator | null {
  for (const zone of ZONES) {
    const idx = state.zones[zone].findIndex((c) => c.id === cardId);
    if (idx >= 0) return { source: 'zone', zone, index: idx };
  }
  const bfIdx = state.battlefield.findIndex((b) => b.card.id === cardId);
  if (bfIdx >= 0) return { source: 'battlefield', index: bfIdx };
  return null;
}

/** Remove the card identified by `loc` from its current location. Returns it. */
function pluck(
  next: Omit<PlaytestState, 'past'>,
  loc: Locator
): { card: PlaytestCard; bf?: BattlefieldCard } {
  if (loc.source === 'zone' && loc.zone) {
    const zone = next.zones[loc.zone].slice();
    const [card] = zone.splice(loc.index, 1);
    next.zones[loc.zone] = zone;
    return { card };
  }
  const battlefield = next.battlefield.slice();
  const [bf] = battlefield.splice(loc.index, 1);
  next.battlefield = battlefield;
  return { card: bf.card, bf };
}

export function applyAction(state: PlaytestState, action: PlaytestAction): PlaytestState {
  switch (action.type) {
    case 'UNDO': {
      if (state.past.length === 0) return state;
      const [head, ...rest] = state.past;
      return { ...head, past: rest };
    }
    case 'RESET': {
      // RESET is irreversible by design — clears history along with everything else.
      const all = [
        ...state.zones.library,
        ...state.zones.hand,
        ...state.zones.graveyard,
        ...state.zones.exile,
        ...state.battlefield.filter((b) => !b.card.isToken).map((b) => b.card),
      ];
      const shuffled = shuffle(all, mulberry32(state.rngSeed));
      const hand = shuffled.slice(0, DEFAULT_OPENING_HAND);
      const library = shuffled.slice(DEFAULT_OPENING_HAND);
      return {
        zones: { ...emptyZones(), library, hand, command: state.zones.command.slice() },
        battlefield: [],
        rngSeed: nextSeed(state.rngSeed),
        turn: 1,
        past: [],
      };
    }
    case 'DRAW': {
      const n = action.n ?? 1;
      if (n <= 0 || state.zones.library.length === 0) return state;
      const take = Math.min(n, state.zones.library.length);
      const next = snapshot(state);
      const drawn = next.zones.library.slice(0, take);
      next.zones.library = next.zones.library.slice(take);
      next.zones.hand = next.zones.hand.concat(drawn);
      return withHistory(state, next);
    }
    case 'SHUFFLE_LIBRARY': {
      const next = snapshot(state);
      next.zones.library = shuffle(next.zones.library, mulberry32(state.rngSeed));
      next.rngSeed = nextSeed(state.rngSeed);
      return withHistory(state, next);
    }
    case 'MULLIGAN': {
      const handSize = action.handSize ?? DEFAULT_OPENING_HAND;
      const next = snapshot(state);
      const combined = next.zones.library.concat(next.zones.hand);
      const shuffled = shuffle(combined, mulberry32(state.rngSeed));
      const take = Math.min(handSize, shuffled.length);
      next.zones.hand = shuffled.slice(0, take);
      next.zones.library = shuffled.slice(take);
      next.rngSeed = nextSeed(state.rngSeed);
      return withHistory(state, next);
    }
    case 'MOVE_TO_ZONE': {
      const loc = locate(state, action.cardId);
      if (!loc) return state;
      const next = snapshot(state);
      const { card, bf } = pluck(next, loc);
      // Tokens that leave the battlefield cease to exist (MTG rule 704.5d).
      if (bf?.card.isToken && action.to !== 'command') return withHistory(state, next);
      const dest = next.zones[action.to].slice();
      const insertAt = action.toIndex ?? dest.length;
      dest.splice(Math.max(0, Math.min(insertAt, dest.length)), 0, card);
      next.zones[action.to] = dest;
      return withHistory(state, next);
    }
    case 'MOVE_TO_BATTLEFIELD': {
      const loc = locate(state, action.cardId);
      if (!loc) return state;
      const next = snapshot(state);
      const plucked = pluck(next, loc);
      // If already on the battlefield, treat as a reposition + optional state update.
      const bfCard: BattlefieldCard = plucked.bf
        ? {
            ...plucked.bf,
            x: action.x,
            y: action.y,
            tapped: action.tapped ?? plucked.bf.tapped,
            faceDown: action.faceDown ?? plucked.bf.faceDown,
          }
        : {
            card: plucked.card,
            tapped: action.tapped ?? false,
            faceDown: action.faceDown ?? false,
            counters: {},
            x: action.x,
            y: action.y,
          };
      next.battlefield = next.battlefield.concat(bfCard);
      return withHistory(state, next);
    }
    case 'MOVE_BF_POSITION': {
      const idx = state.battlefield.findIndex((b) => b.card.id === action.cardId);
      if (idx < 0) return state;
      const next = snapshot(state);
      next.battlefield = next.battlefield.map((b, i) =>
        i === idx ? { ...b, x: action.x, y: action.y } : b
      );
      return withHistory(state, next);
    }
    case 'TAP': {
      const idx = state.battlefield.findIndex((b) => b.card.id === action.cardId);
      if (idx < 0) return state;
      const next = snapshot(state);
      next.battlefield = next.battlefield.map((b, i) =>
        i === idx ? { ...b, tapped: action.tapped ?? !b.tapped } : b
      );
      return withHistory(state, next);
    }
    case 'UNTAP_ALL': {
      if (state.battlefield.every((b) => !b.tapped)) return state;
      const next = snapshot(state);
      next.battlefield = next.battlefield.map((b) => (b.tapped ? { ...b, tapped: false } : b));
      return withHistory(state, next);
    }
    case 'SET_COUNTER': {
      const idx = state.battlefield.findIndex((b) => b.card.id === action.cardId);
      if (idx < 0) return state;
      const current = state.battlefield[idx].counters[action.counter] ?? 0;
      const updated = current + action.delta;
      const next = snapshot(state);
      next.battlefield = next.battlefield.map((b, i) => {
        if (i !== idx) return b;
        const counters = { ...b.counters };
        if (updated <= 0) delete counters[action.counter];
        else counters[action.counter] = updated;
        return { ...b, counters };
      });
      return withHistory(state, next);
    }
    case 'CREATE_TOKEN': {
      const next = snapshot(state);
      next.battlefield = next.battlefield.concat({
        card: { ...action.card, isToken: true },
        tapped: false,
        faceDown: false,
        counters: {},
        x: action.x,
        y: action.y,
      });
      return withHistory(state, next);
    }
    case 'FLIP_FACE': {
      const idx = state.battlefield.findIndex((b) => b.card.id === action.cardId);
      if (idx < 0) return state;
      const next = snapshot(state);
      next.battlefield = next.battlefield.map((b, i) =>
        i === idx ? { ...b, faceDown: !b.faceDown } : b
      );
      return withHistory(state, next);
    }
    case 'NEXT_TURN': {
      const next = snapshot(state);
      next.turn = state.turn + 1;
      next.battlefield = next.battlefield.map((b) => (b.tapped ? { ...b, tapped: false } : b));
      if (state.zones.library.length > 0) {
        next.zones.library = next.zones.library.slice(1);
        next.zones.hand = next.zones.hand.concat(state.zones.library[0]);
      }
      return withHistory(state, next);
    }
  }
}
