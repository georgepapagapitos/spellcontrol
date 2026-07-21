import type { GameEvent } from './game-state';

export interface RichEvent {
  target?: string;
  action: string;
  delta?: number;
  source?: string;
}

/** Minimal shape describeGameEvent needs — satisfied by both a live
 *  GameHistory TimelineRow (grouped) and a raw GameEvent (ungrouped, as
 *  shipped in a game-result share's notableEvents). */
export interface DescribableEvent {
  kind: GameEvent['kind'];
  targetSeat: number | null;
  actorSeat: number | null;
  fromSeat?: number;
  delta?: number;
  message?: string;
}

/**
 * Turns one game-log row into display parts, resolving seat numbers to
 * names via the caller-supplied `seatName` — live games resolve from
 * `game.players` (GameHistory), the public game-summary view resolves from
 * a PublicGameResultShare's participants. Extracted verbatim from
 * GameHistory.tsx's private `describeRow`/`RichEvent` so the live timeline
 * and the public summary render events in one consistent vocabulary instead
 * of a second copy drifting out of sync — behavior-preserving, not a rewrite.
 */
export function describeGameEvent(
  row: DescribableEvent,
  seatName: (seat: number | null | undefined) => string | undefined
): RichEvent {
  switch (row.kind) {
    case 'life':
      return { target: seatName(row.targetSeat), action: 'life', delta: row.delta };
    case 'set-life':
      return { target: seatName(row.targetSeat), action: 'life set', delta: row.delta };
    case 'poison':
      return { target: seatName(row.targetSeat), action: 'poison', delta: row.delta };
    case 'cmd-dmg':
      return {
        target: seatName(row.targetSeat),
        action: 'cmd dmg',
        delta: row.delta,
        source: seatName(row.fromSeat),
      };
    case 'eliminate':
      return {
        target: seatName(row.targetSeat),
        action: row.message === 'auto' ? 'eliminated (auto)' : 'eliminated',
      };
    case 'revive':
      return { target: seatName(row.targetSeat), action: 'revived' };
    case 'start':
      return { action: 'Game started' };
    case 'end':
      return row.targetSeat != null
        ? { target: seatName(row.targetSeat), action: 'wins — game ended' }
        : { action: 'Game ended' };
    case 'reset':
      return { action: 'Game reset' };
    case 'join':
      return { action: `${row.message ?? seatName(row.targetSeat) ?? 'player'} joined` };
    case 'leave':
      return { action: `${row.message ?? seatName(row.targetSeat) ?? 'player'} left` };
    case 'note':
      return { action: row.message ?? 'note' };
    case 'settings':
      return { action: 'Settings changed' };
    default:
      return { action: row.kind };
  }
}

/** Flattens a RichEvent into one human-readable sentence, in the same
 *  target/action/delta/source order the live Timeline renders as separate
 *  spans — used wherever a single string (rather than a multi-span row) is
 *  needed, e.g. the public game-summary's notable-moments list. */
export function formatGameEventSentence(event: RichEvent): string {
  const delta = event.delta != null ? `${event.delta > 0 ? '+' : ''}${event.delta}` : undefined;
  const source = event.source ? `from ${event.source}` : undefined;
  return [event.target, event.action, delta, source].filter((s): s is string => !!s).join(' ');
}
