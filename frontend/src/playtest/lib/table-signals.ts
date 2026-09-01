import type { GamePlayer } from '@/lib/game-state';
import type { GameSignal } from '@/lib/games-api';

/** The fixed reaction set — the server whitelists exactly these six, so this
 *  is the one place both the picker and the incoming display agree on them. */
export const REACTION_EMOTES = ['👏', '😬', '🤔', '🔥', '😂', '🫡'] as const;
export type ReactionEmote = (typeof REACTION_EMOTES)[number];

/** Longest chat message the table accepts. Mirrors `MAX_CHAT_LEN` in backend
 *  `routes/games.ts`, which is the authority and 400s past it; this only
 *  stops a player from typing a message that would be rejected on send.
 *  Lives here rather than in the composer for the same reason
 *  `REACTION_EMOTES` does — it is a server contract, not a component detail. */
export const MAX_CHAT_LEN = 240;

/** Screen-reader / status-text name for each emote — also doubles as the
 *  picker button's `aria-label`. */
export const REACTION_LABEL: Record<ReactionEmote, string> = {
  '👏': 'Applause',
  '😬': 'Wince',
  '🤔': 'Thinking',
  '🔥': 'Fire',
  '😂': 'Laughing',
  '🫡': 'Respect',
};

function playerName(players: GamePlayer[], seat: number): string {
  return players.find((p) => p.seat === seat)?.name ?? 'A player';
}

/**
 * The single sentence shown (and announced) for an incoming point.
 *
 * Addressed in the second person when the point lands on the reader's own
 * board — "is pointing at your Sol Ring" — because that is the entire
 * purpose of a point at a manual-enforcement table: it is how a player says
 * "this one, yours" while announcing a target or an attack, and the seat
 * being pointed at is the one that has to act on it. Every other seat reads
 * the same event in the third person so the table can follow along.
 *
 * `cardName` is whatever the caller could resolve from the target seat's
 * published board, and is expected to be absent routinely — the card may
 * have moved zones since, may be face-down (redacted upstream by
 * `toPublicBoard`), or the point may simply have been at the seat as a
 * whole. It degrades to the board rather than naming a card the reader
 * cannot see.
 */
export function formatPointCopy(
  signal: GameSignal,
  players: GamePlayer[],
  mySeat: number,
  cardName?: string
): string {
  const from = playerName(players, signal.seat);
  const atMe = signal.targetSeat === mySeat;
  const whose = atMe ? 'your' : `${playerName(players, signal.targetSeat ?? -1)}'s`;
  return cardName
    ? `${from} is pointing at ${whose} ${cardName}`
    : `${from} is pointing at ${whose} board`;
}

/** The single sentence the incoming-signal layer shows for a roll — also
 *  what gets announced via its `role="status"`. */
export function formatRollCopy(signal: GameSignal, players: GamePlayer[]): string {
  if (signal.die === 'coin') return `Coin: ${signal.value === 0 ? 'heads' : 'tails'}`;
  if (signal.die === 'first') return `${playerName(players, signal.value ?? -1)} goes first!`;
  return `${playerName(players, signal.seat)} rolled ${signal.die}: ${signal.value}`;
}
