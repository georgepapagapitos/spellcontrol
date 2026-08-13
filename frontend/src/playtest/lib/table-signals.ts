import type { GamePlayer } from '@/lib/game-state';
import type { GameSignal } from '@/lib/games-api';

/** The fixed reaction set — the server whitelists exactly these six, so this
 *  is the one place both the picker and the incoming display agree on them. */
export const REACTION_EMOTES = ['👏', '😬', '🤔', '🔥', '😂', '🫡'] as const;
export type ReactionEmote = (typeof REACTION_EMOTES)[number];

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

/** The single sentence the incoming-signal layer shows for a roll — also
 *  what gets announced via its `role="status"`. */
export function formatRollCopy(signal: GameSignal, players: GamePlayer[]): string {
  if (signal.die === 'coin') return `Coin: ${signal.value === 0 ? 'heads' : 'tails'}`;
  if (signal.die === 'first') return `${playerName(players, signal.value ?? -1)} goes first!`;
  return `${playerName(players, signal.seat)} rolled ${signal.die}: ${signal.value}`;
}
