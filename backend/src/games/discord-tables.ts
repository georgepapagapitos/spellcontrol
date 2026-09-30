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
 *
 * A game's channel is "Table N", and which channel it owns is its session's
 * `discord_channel_id`: the name never carries the join code.
 */

/**
 * Code → channel for tables this process opened, because teardown runs after
 * the session row is already gone. A restart forgets them; the sweep, which
 * reads the column, catches those.
 */
const discordTables = new Map<string, string>();

/** Called from game deletion: close the code's table if it has one. */
export function releaseDiscordTable(code: string): void {
  const channelId = discordTables.get(code);
  if (!channelId) return;
  discordTables.delete(code);
  void closeTableChannel(channelId);
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
 * Opens run one at a time: two hosts pressing at once would both see Table 1
 * as free, and Discord allows two channels with one name.
 */
let opening: Promise<unknown> = Promise.resolve();

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
  const open = opening.then(async () => {
    const table = await openTableChannel(row.discordChannelId ?? null);
    if (table.channelId !== row.discordChannelId) {
      await getDb()
        .update(gameSessions)
        .set({ discordChannelId: table.channelId })
        .where(eq(gameSessions.code, code));
    }
    discordTables.set(code, table.channelId);
    return table.url;
  });
  opening = open.catch(() => {});
  try {
    res.json({ url: await open });
  } catch (err) {
    logger.error(`[discord] opening table ${code} failed`, err);
    res.status(502).json({ error: 'Discord did not answer. Try again in a moment.' });
  }
}

/** A finished game keeps its table this long, for the post-game chat. */
const DISCORD_FINISHED_GRACE_MS = 30 * 60 * 1000;
/**
 * Nobody has had the game open in this long: the table was walked away from
 * without anyone pressing Leave. Long enough for a locked phone or a dropped
 * connection to come back.
 */
const DISCORD_ABANDONED_MS = 15 * 60 * 1000;
/**
 * An unfinished game untouched this long. Only the backstop now: after a
 * restart this process has seen nobody, so `seenAt` can't answer for a while.
 */
const DISCORD_IDLE_MS = 3 * 60 * 60 * 1000;

/** When anyone last had a game open, or null if unknown (live-registry). */
export type SeenAt = (code: string, now: number) => number | null;

/**
 * Remove every table channel no game owns, or whose game finished past the
 * grace window, was left open by nobody for `DISCORD_ABANDONED_MS`, or went
 * idle. Channels from before numbering (named by the code, then by a tag) are
 * owned by nothing, so they go too. The backstop for teardown that happened
 * while Discord was down, or before a restart emptied `discordTables`.
 * `seenAt` is live-registry's `lastSeenAt`, passed in because the registry
 * imports this module. Returns how many went.
 */
export async function sweepDiscordTables(
  now = Date.now(),
  seenAt: SeenAt = () => null
): Promise<number> {
  if (!isDiscordConfigured()) return 0;
  const channels = await listTableChannels();
  if (channels.length === 0) return 0;
  const rows = await getDb()
    .select({
      code: gameSessions.code,
      status: gameSessions.status,
      updatedAt: gameSessions.updatedAt,
      channelId: gameSessions.discordChannelId,
    })
    .from(gameSessions)
    .where(
      inArray(
        gameSessions.discordChannelId,
        channels.map((ch) => ch.id)
      )
    );
  const byChannel = new Map(rows.map((r) => [r.channelId, r]));
  let removed = 0;
  for (const ch of channels) {
    const game = byChannel.get(ch.id);
    const seen = game ? seenAt(game.code, now) : null;
    const stale =
      !game ||
      (game.status === 'finished'
        ? now - game.updatedAt > DISCORD_FINISHED_GRACE_MS
        : (seen !== null && now - seen > DISCORD_ABANDONED_MS) ||
          now - game.updatedAt > DISCORD_IDLE_MS);
    if (!stale) {
      discordTables.set(game.code, ch.id);
      continue;
    }
    try {
      await deleteTableChannel(ch.id);
      if (game) discordTables.delete(game.code);
      removed++;
    } catch (err) {
      logger.warn(`[discord] sweeping ${ch.name} failed`, err);
    }
  }
  return removed;
}
