/**
 * Playtest game log (E140) — a journal of what happened this game, distinct
 * from the reducer's `past` undo stack. Deliberately NOT part of the pure
 * reducer: the log records history (including things that get undone), so it
 * lives at the store layer and is built from before/after reducer snapshots.
 *
 * Entry shape is kept flat and union-typed (`kind`) so E141's session
 * analytics can aggregate over it without re-parsing prose.
 */

import { MANA_COLOR_LABEL } from './types';
import type { PlaytestAction, PlaytestCard, PlaytestState, Zone } from './types';
import { classifyAction, type RewindVerdict } from './rewind';

export type LogEntryKind =
  | 'turn'
  | 'draw'
  | 'play'
  | 'zone-move'
  | 'mulligan'
  | 'shuffle'
  | 'scry'
  | 'mill'
  | 'token'
  | 'tap-all'
  | 'resistance'
  | 'undo'
  | 'reset'
  | 'life'
  | 'designation'
  | 'attach'
  | 'counter'
  | 'phase'
  | 'mana';

export interface GameLogEntry {
  /** Monotonic within a session — always ascending in log order. */
  seq: number;
  turn: number;
  kind: LogEntryKind;
  text: string;
  cardName?: string;
  /** Rewind classification (see rewind.ts), computed from the action and the
   *  state immediately before it at the moment this entry was built. Optional
   *  for back-compat — same pattern as `BattlefieldCard.phased` and the
   *  snapshot life fields: a log entry persisted before this field existed
   *  loads with it simply absent, and `walkRewindable` treats a missing
   *  verdict as a conservative `locked` wall rather than assuming it's safe. */
  verdict?: RewindVerdict;
}

/** Oldest entries drop first once the log exceeds this many. */
export const MAX_LOG_ENTRIES = 500;

const ZONE_LABEL: Record<Zone, string> = {
  library: 'library',
  hand: 'hand',
  graveyard: 'graveyard',
  exile: 'exile',
  command: 'command zone',
};

function opponentLabel(count: number, i: number): string {
  return count > 1 ? `Opponent ${i + 1}` : 'Opponent';
}

const DESIGNATION_LABEL = {
  monarch: 'the Monarch',
  initiative: 'the Initiative',
  citysBlessing: "the City's Blessing",
} as const;

function locate(
  state: PlaytestState,
  cardId: string
): { card: PlaytestCard; from: Zone | 'battlefield' } | null {
  for (const zone of Object.keys(state.zones) as Zone[]) {
    const card = state.zones[zone].find((c) => c.id === cardId);
    if (card) return { card, from: zone };
  }
  const bf = state.battlefield.find((b) => b.card.id === cardId);
  return bf ? { card: bf.card, from: 'battlefield' } : null;
}

/**
 * Pure: derive zero or more log entries for one reducer action, given the
 * state immediately before and after. RESET and UNDO are handled by the
 * caller (store.ts) instead — they need bookkeeping (resistance state, "did
 * this undo actually pop anything") the reducer snapshots alone don't carry.
 */
export function buildLogEntries(
  current: PlaytestState,
  action: PlaytestAction,
  next: PlaytestState
): Array<Omit<GameLogEntry, 'seq'>> {
  const entries = buildRawLogEntries(current, action, next);
  if (entries.length === 0) return entries;
  // classifyAction only needs the action + the state right before it, which
  // is exactly what's in scope here — the one place downstream code (the
  // `past` undo stack stores states, not actions) can no longer recover it.
  const { verdict } = classifyAction(current, action);
  return entries.map((e) => ({ ...e, verdict }));
}

function buildRawLogEntries(
  current: PlaytestState,
  action: PlaytestAction,
  next: PlaytestState
): Array<Omit<GameLogEntry, 'seq'>> {
  const turn = next.turn;
  switch (action.type) {
    case 'NEXT_TURN':
      return [{ turn, kind: 'turn', text: `Turn ${turn} begins` }];

    case 'DRAW': {
      const drawn = next.zones.hand.length - current.zones.hand.length;
      if (drawn <= 0) return [];
      return [{ turn, kind: 'draw', text: `Drew ${drawn} card${drawn === 1 ? '' : 's'}` }];
    }

    case 'SHUFFLE_LIBRARY':
      return [{ turn, kind: 'shuffle', text: 'Shuffled the library' }];

    case 'MULLIGAN':
      return [{ turn, kind: 'mulligan', text: `Mulliganed to ${next.zones.hand.length}` }];

    case 'RESOLVE_TOP': {
      if (next === current) return []; // no-op (nothing resolvable in the lists)
      // Milled count comes from the resulting state, so ids the reducer
      // discarded (not in the library, or repeated) can't inflate it.
      const milled = next.zones.graveyard.length - current.zones.graveyard.length;
      if (action.mode === 'mill') {
        return [{ turn, kind: 'mill', text: `Milled ${milled} card${milled === 1 ? '' : 's'}` }];
      }
      const looked = new Set([...action.top, ...(action.bottom ?? []), ...(action.graveyard ?? [])])
        .size;
      const kept = new Set(action.top).size;
      const verb = action.mode === 'scry' ? 'Scried' : 'Surveilled';
      const away =
        action.mode === 'scry' ? `${looked - kept} to the bottom` : `${milled} to the graveyard`;
      return [
        {
          turn,
          kind: action.mode === 'surveil' ? 'mill' : 'scry',
          text: looked > kept ? `${verb} ${looked} — ${away}` : `${verb} ${looked}`,
        },
      ];
    }

    case 'MOVE_TO_BATTLEFIELD': {
      const loc = locate(current, action.cardId);
      if (!loc || loc.from === 'battlefield') return []; // reposition, not a play
      return [
        {
          turn,
          kind: 'play',
          text: `${loc.card.name} played from ${ZONE_LABEL[loc.from]}`,
          cardName: loc.card.name,
        },
      ];
    }

    case 'MOVE_TO_ZONE': {
      const loc = locate(current, action.cardId);
      if (!loc || loc.from === action.to) return [];
      if (loc.from === 'battlefield') {
        const bf = current.battlefield.find((b) => b.card.id === action.cardId);
        if (bf?.card.isToken && action.to !== 'command') {
          return [
            {
              turn,
              kind: 'zone-move',
              text: `${loc.card.name} left the battlefield (ceased to exist)`,
              cardName: loc.card.name,
            },
          ];
        }
        return [
          {
            turn,
            kind: 'zone-move',
            text: `${loc.card.name}: battlefield → ${ZONE_LABEL[action.to]}`,
            cardName: loc.card.name,
          },
        ];
      }
      return [
        {
          turn,
          kind: 'zone-move',
          text: `${loc.card.name}: ${ZONE_LABEL[loc.from]} → ${ZONE_LABEL[action.to]}`,
          cardName: loc.card.name,
        },
      ];
    }

    case 'CREATE_TOKEN':
      return [
        {
          turn,
          kind: 'token',
          text: `Created token: ${action.card.name}`,
          cardName: action.card.name,
        },
      ];

    case 'CLONE_BF_CARDS': {
      // Counted from the resulting battlefield, so clones whose source had
      // already left don't get logged as though they happened.
      const made = next.battlefield.length - current.battlefield.length;
      if (made <= 0) return [];
      const only = made === 1 ? next.battlefield.at(-1)?.card.name : undefined;
      return [
        {
          turn,
          kind: 'token',
          text: only ? `Copied ${only}` : `Copied ${made} permanents`,
          ...(only && { cardName: only }),
        },
      ];
    }

    case 'UNTAP_ALL':
      return [{ turn, kind: 'tap-all', text: 'Untapped all permanents' }];

    case 'ADJUST_LIFE': {
      if (next === current) return []; // no-op (zero delta or bad index)
      if (action.player === 'self') {
        return [{ turn, kind: 'life', text: `Your life: ${current.life} → ${next.life}` }];
      }
      const label = opponentLabel(current.opponents.length, action.player);
      return [
        {
          turn,
          kind: 'life',
          text: `${label} life: ${current.opponents[action.player].life} → ${next.opponents[action.player].life}`,
        },
      ];
    }

    case 'ADJUST_COMMANDER_DAMAGE': {
      if (next === current) return []; // no-op
      const label = opponentLabel(current.opponents.length, action.opponent);
      return [
        {
          turn,
          kind: 'life',
          text: `${label} commander damage: ${current.opponents[action.opponent].commanderDamage} → ${next.opponents[action.opponent].commanderDamage}`,
        },
      ];
    }

    case 'ATTACH': {
      if (next === current) return []; // no-op (missing card, cycle, or already attached)
      const card = current.battlefield.find((b) => b.card.id === action.cardId)?.card;
      if (!card) return [];
      if (action.targetId === null) {
        return [{ turn, kind: 'attach', text: `${card.name} unattached`, cardName: card.name }];
      }
      const host = current.battlefield.find((b) => b.card.id === action.targetId)?.card;
      if (!host) return [];
      return [
        {
          turn,
          kind: 'attach',
          text: `${card.name} attached to ${host.name}`,
          cardName: card.name,
        },
      ];
    }

    case 'SET_PLAYER_COUNTER': {
      if (next === current) return []; // no-op (floored at zero, or bad index)
      const read = (state: PlaytestState): number =>
        action.player === 'self'
          ? (state.playerCounters?.[action.counter] ?? 0)
          : (state.opponents[action.player].counters?.[action.counter] ?? 0);
      const label =
        action.player === 'self' ? 'You' : opponentLabel(current.opponents.length, action.player);
      return [
        {
          turn,
          kind: 'counter',
          text: `${label}: ${action.counter} ${read(current)} → ${read(next)}`,
        },
      ];
    }

    case 'TOGGLE_PHASED': {
      const card = current.battlefield.find((b) => b.card.id === action.cardId)?.card;
      if (!card) return [];
      const nowPhased = next.battlefield.find((b) => b.card.id === action.cardId)?.phased ?? false;
      return [
        {
          turn,
          kind: 'phase',
          text: `${card.name} ${nowPhased ? 'phased out' : 'phased in'}`,
          cardName: card.name,
        },
      ];
    }

    case 'ADJUST_MANA': {
      if (next === current) return []; // no-op (already at zero and delta went negative)
      const pool = current.manaPool;
      const before = pool?.[action.color] ?? 0;
      const after = next.manaPool?.[action.color] ?? 0;
      return [
        {
          turn,
          kind: 'mana',
          text: `${MANA_COLOR_LABEL[action.color]} mana: ${before} → ${after}`,
        },
      ];
    }

    case 'EMPTY_MANA_POOL':
      if (next === current) return []; // no-op (already empty)
      return [{ turn, kind: 'mana', text: 'Emptied mana pool' }];

    case 'SET_DESIGNATION': {
      if (next === current) return []; // no-op (already in that state)
      const label = DESIGNATION_LABEL[action.designation];
      if (!action.held) return [{ turn, kind: 'designation', text: `Lost ${label}` }];
      const verb = action.designation === 'citysBlessing' ? 'Achieved' : 'Took';
      return [{ turn, kind: 'designation', text: `${verb} ${label}` }];
    }

    default:
      return [];
  }
}

/** Stamps `entries` with ascending `seq` continuing from `log`'s last entry,
 *  appends, and drops the oldest past `MAX_LOG_ENTRIES`. */
export function appendLogEntries(
  log: readonly GameLogEntry[],
  entries: ReadonlyArray<Omit<GameLogEntry, 'seq'>>
): GameLogEntry[] {
  if (entries.length === 0) return log as GameLogEntry[];
  let seq = (log.at(-1)?.seq ?? 0) + 1;
  const stamped = entries.map((e) => ({ ...e, seq: seq++ }));
  return [...log, ...stamped].slice(-MAX_LOG_ENTRIES);
}

export interface TurnGroup {
  turn: number;
  entries: GameLogEntry[];
}

/**
 * Buckets entries into contiguous by-turn groups in chronological order. A
 * `reset` entry always starts a fresh group (even though RESET always resets
 * `turn` to 1, so a reset mid-turn-1 wouldn't otherwise look like a boundary).
 */
export function groupLogByTurn(log: readonly GameLogEntry[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  for (const entry of log) {
    const last = groups[groups.length - 1];
    if (!last || entry.turn !== last.turn || entry.kind === 'reset') {
      groups.push({ turn: entry.turn, entries: [entry] });
    } else {
      last.entries.push(entry);
    }
  }
  return groups;
}

/** Plain-text recap, oldest turn first — reads naturally when pasted into
 *  notes/Discord. */
export function formatLogForClipboard(log: readonly GameLogEntry[]): string {
  if (log.length === 0) return 'No game events yet.';
  return groupLogByTurn(log)
    .map((g) => `Turn ${g.turn}\n${g.entries.map((e) => `- ${e.text}`).join('\n')}`)
    .join('\n\n');
}
