import type { Request, Response } from 'express';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../db';
import { gameSessions } from '../db/schema';
import {
  closeTableChannel,
  communityInviteUrl,
  deleteTableChannel,
  isDiscordConfigured,
  listTableChannels,
  openTableChannel,
} from '../discord';
import { logger } from '../logger';
import type { GameState } from './state';

/**
 * The game side of Discord tables (the Discord side is `src/discord.ts`):
 * the host's open-a-table route, teardown when a game is deleted, and the
 * sweep that catches what teardown missed. `routes/games.ts` only wires these.
 */

/**
 * Codes this process opened a Discord table for, so teardown only calls
 * Discord for a game that has one. A restart forgets them; `sweepDiscordTables`
 * is what catches those.
 */
const discordTables = new Set<string>();

/** Called from game deletion: close the code's table if it has one. */
export function releaseDiscordTable(code: string): void {
  if (discordTables.delete(code)) void closeTableChannel(code);
}

/**
 * GET /api/games/discord — whether the host can open a Discord table, so the
 * lobby shows the button only when pressing it can work, and the community
 * server's permanent invite (null when unset) for the Play page's link.
 */
export function discordStatus(_req: Request, res: Response): void {
  res.json({ enabled: isDiscordConfigured(), inviteUrl: communityInviteUrl() });
}

/**
 * POST /api/games/:code/discord — the host opens (or reopens) this table's
 * voice channel in the SpellControl Discord and gets its invite link back.
 * The client stores the link through the ordinary `voiceUrl` setting, so the
 * link's validation and the version check stay where they already are.
 */
export async function openDiscordTable(req: Request, res: Response) {
  const code = String(req.params.code).toUpperCase();
  const rows = await getDb()
    .select()
    .from(gameSessions)
    .where(eq(gameSessions.code, code))
    .limit(1);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Game not found.' });
  const current = row.state as GameState;
  // A stranger gets the same 404 as an unknown code (see resolveGameAccess).
  if (!current.players.some((p) => p.userId === req.user!.id)) {
    return res.status(404).json({ error: 'Game not found.' });
  }
  if (current.hostUserId !== req.user!.id) {
    return res.status(403).json({ error: 'Only the host can open a Discord table.' });
  }
  if (current.status === 'finished') {
    return res.status(409).json({ error: 'This game is over.' });
  }
  if (!isDiscordConfigured()) {
    return res.status(503).json({ error: 'Discord tables are not set up.' });
  }
  try {
    const url = await openTableChannel(code);
    discordTables.add(code);
    res.json({ url });
  } catch (err) {
    logger.error(`[discord] opening table ${code} failed`, err);
    res.status(502).json({ error: 'Discord did not answer. Try again in a moment.' });
  }
}

/** A finished game keeps its table this long, for the post-game chat. */
const DISCORD_FINISHED_GRACE_MS = 30 * 60 * 1000;
/** An unfinished game nobody has touched in this long has been left. */
const DISCORD_IDLE_MS = 3 * 60 * 60 * 1000;

/**
 * Remove every table channel whose game is gone, finished past the grace
 * window, or idle. The backstop for teardown that happened while Discord was
 * down, or before a restart emptied `discordTables`. Returns how many went.
 */
export async function sweepDiscordTables(now = Date.now()): Promise<number> {
  if (!isDiscordConfigured()) return 0;
  const channels = await listTableChannels();
  if (channels.length === 0) return 0;
  const rows = await getDb()
    .select({
      code: gameSessions.code,
      status: gameSessions.status,
      updatedAt: gameSessions.updatedAt,
    })
    .from(gameSessions)
    .where(
      inArray(
        gameSessions.code,
        channels.map((ch) => ch.code)
      )
    );
  const byCode = new Map(rows.map((r) => [r.code, r]));
  let removed = 0;
  for (const ch of channels) {
    const game = byCode.get(ch.code);
    const stale =
      !game ||
      (game.status === 'finished'
        ? now - game.updatedAt > DISCORD_FINISHED_GRACE_MS
        : now - game.updatedAt > DISCORD_IDLE_MS);
    if (!stale) {
      discordTables.add(ch.code);
      continue;
    }
    try {
      await deleteTableChannel(ch.id);
      discordTables.delete(ch.code);
      removed++;
    } catch (err) {
      logger.warn(`[discord] sweeping table ${ch.code} failed`, err);
    }
  }
  return removed;
}
