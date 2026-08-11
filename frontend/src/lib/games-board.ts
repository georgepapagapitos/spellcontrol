import { postBoard } from './games-api';
import type { PublicBoard } from './playtest/projection';

/**
 * Debounce window for `publishBoard` — a `PublicBoard` projection is
 * whole-state (the entire battlefield/zones, not a diff), so rapid local
 * changes (drag, life taps, zone moves) should coalesce into one POST
 * instead of firing on every intermediate change.
 */
const PUBLISH_DEBOUNCE_MS = 150;

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: { code: string; board: PublicBoard } | null = null;

/**
 * Publish the local player's board to the table
 * (`POST /api/games/:code/board` — backend: routes/games.ts), debounced:
 * rapid successive calls collapse into one request fired
 * `PUBLISH_DEBOUNCE_MS` after the last one. Best-effort — a dropped publish
 * self-heals on the next board change, so failures are swallowed rather than
 * surfaced or retried.
 */
export function publishBoard(code: string, board: PublicBoard): void {
  pending = { code, board };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const next = pending;
    pending = null;
    if (next) {
      void postBoard(next.code, next.board).catch(() => {
        // Ephemeral, high-frequency data — nothing to surface or retry.
      });
    }
  }, PUBLISH_DEBOUNCE_MS);
}

/** Cancel a pending debounced publish — call on leaving a game / unmounting. */
export function cancelBoardPublish(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  pending = null;
}
