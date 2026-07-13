/**
 * Playtest game log (E140) — a journal of what happened this game, distinct
 * from the reducer's `past` undo stack. Deliberately NOT part of the pure
 * reducer: the log records history (including things that get undone), so it
 * lives at the store layer and is built from before/after reducer snapshots.
 *
 * Entry shape is kept flat and union-typed (`kind`) so E141's session
 * analytics can aggregate over it without re-parsing prose.
 */

import type { PlaytestAction, PlaytestCard, PlaytestState, Zone } from './types';

export type LogEntryKind =
  | 'turn'
  | 'draw'
  | 'play'
  | 'zone-move'
  | 'mulligan'
  | 'shuffle'
  | 'scry'
  | 'token'
  | 'tap-all'
  | 'resistance'
  | 'undo'
  | 'reset';

export interface GameLogEntry {
  /** Monotonic within a session — always ascending in log order. */
  seq: number;
  turn: number;
  kind: LogEntryKind;
  text: string;
  cardName?: string;
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

    case 'UNTAP_ALL':
      return [{ turn, kind: 'tap-all', text: 'Untapped all permanents' }];

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
