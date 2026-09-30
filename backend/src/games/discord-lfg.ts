import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { gameSessions } from '../db/schema';
import { deleteMessage, editMessage, lfgChannelId, listBotMessages, postMessage } from '../discord';
import { logger } from '../logger';
import { projectGameListing, STALE_LISTING_MS, type GameListing } from './sessions';
import type { GameState } from './state';

/**
 * Open public tables, posted to the SpellControl Discord's looking-for-game
 * channel: one message per public lobby with an open seat, edited as seats
 * fill, deleted when the table fills, starts, goes private or closes.
 *
 * A reconciler, not an event log: every pass reads what the channel should
 * show (the room browser's own projection) and makes the bot's messages
 * match. A missed event, a restart or a message a moderator deleted heals on
 * the next pass. Game changes nudge a pass within seconds; a slower pass
 * re-reads the channel itself as the backstop.
 */

const APP_ORIGIN = 'https://spellcontrol.com';
const FOOTER_PREFIX = 'Table ';
/** Few enough that the channel reads as a list, not a wall. */
const MAX_POSTS = 20;
/** Coalesces a burst of seat changes into one pass. */
const NUDGE_DEBOUNCE_MS = 2_000;
/** Seats a table promises before anyone joins, as the lobby shows them. */
const POD_SIZE = 4;

/** The message body for one open table. Pure, so tests can read it. */
export function lfgMessage(listing: GameListing, voiceUrl: string | null) {
  const format = listing.format.charAt(0).toUpperCase() + listing.format.slice(1);
  // The lobby's own promise: a pod of four, growing past it up to the cap
  // (OnlineLobby's MIN_SEATS). "1 of 10 seated, 9 open" would read as a table
  // that wants nine more players.
  const size = Math.min(listing.max, Math.max(POD_SIZE, listing.seated));
  const seats =
    listing.seated < size
      ? `${listing.seated} of ${size} seated, ${size - listing.seated} open`
      : `${listing.seated} seated, room for more`;
  const bracket = !listing.bracket
    ? ''
    : listing.bracket.min === listing.bracket.max
      ? ` · Bracket ${listing.bracket.min}`
      : ` · Brackets ${listing.bracket.min}–${listing.bracket.max}`;
  const buttons = [
    {
      type: 2,
      style: 5,
      label: 'Join on SpellControl',
      url: `${APP_ORIGIN}/play/online?mode=join&code=${listing.code}`,
    },
    ...(voiceUrl ? [{ type: 2, style: 5, label: 'Join the voice table', url: voiceUrl }] : []),
  ];
  return {
    embeds: [
      {
        title: listing.name,
        description: `${format} · ${seats}${bracket}`,
        color: 0x5865f2,
        // The footer carries the code, so a restart can match its old posts.
        footer: { text: `${FOOTER_PREFIX}${listing.code}` },
      },
    ],
    components: [{ type: 1, components: buttons }],
    // The table name is typed by a player: never let it ping anyone.
    allowed_mentions: { parse: [] },
  };
}

/** The game code a post was made for, from its footer, or null. */
export function codeFromFooter(text: string | undefined): string | null {
  if (!text?.startsWith(FOOTER_PREFIX)) return null;
  const code = text.slice(FOOTER_PREFIX.length);
  return /^[A-Z0-9]{4}$/.test(code) ? code : null;
}

/** Posts this process knows about: code → message id and the body it shows. */
const posted = new Map<string, { id: string; body: string }>();
let loaded = false;

/** Public lobbies with an open seat, newest activity first. */
async function openTables(
  now: number
): Promise<Array<{ listing: GameListing; voiceUrl: string | null }>> {
  const rows = await getDb()
    .select({ state: gameSessions.state })
    .from(gameSessions)
    .where(
      and(
        sql`${gameSessions.state}->>'visibility' = 'public'`,
        eq(gameSessions.status, 'lobby'),
        gt(gameSessions.updatedAt, now - STALE_LISTING_MS)
      )
    )
    .orderBy(desc(gameSessions.updatedAt))
    .limit(MAX_POSTS * 2);
  return rows
    .map((r) => r.state as GameState)
    .map((state) => ({ listing: projectGameListing(state), voiceUrl: state.voiceUrl ?? null }))
    .filter(({ listing }) => listing.joinable)
    .slice(0, MAX_POSTS);
}

/** Read the bot's posts back from Discord: at boot, and on the backstop. */
async function reload(channel: string): Promise<void> {
  const messages = await listBotMessages(channel);
  posted.clear();
  // Oldest first (Discord lists newest first), so a duplicate loses to the
  // original post rather than the other way round.
  for (const m of [...messages].reverse()) {
    const code = codeFromFooter(m.embeds?.[0]?.footer?.text);
    if (!code || posted.has(code)) {
      // Not a table post, or a duplicate: neither belongs in the channel.
      await deleteMessage(channel, m.id);
      continue;
    }
    // An unknown body, so the first pass re-edits it to the current one.
    posted.set(code, { id: m.id, body: '' });
  }
  loaded = true;
}

async function reconcile(fromDiscord: boolean, now = Date.now()): Promise<void> {
  const channel = lfgChannelId();
  if (!channel) return;
  if (fromDiscord || !loaded) await reload(channel);
  const want = new Map(
    (await openTables(now)).map(({ listing, voiceUrl }) => [
      listing.code,
      JSON.stringify(lfgMessage(listing, voiceUrl)),
    ])
  );
  for (const [code, post] of posted) {
    if (want.has(code)) continue;
    await deleteMessage(channel, post.id);
    posted.delete(code);
  }
  for (const [code, body] of want) {
    const post = posted.get(code);
    if (post?.body === body) continue;
    if (post) {
      await editMessage(channel, post.id, JSON.parse(body));
      post.body = body;
    } else {
      posted.set(code, { id: await postMessage(channel, JSON.parse(body)), body });
    }
  }
}

/** Passes run one at a time: two at once would both post the same table. */
let queue: Promise<void> = Promise.resolve();

export function syncLfgPosts(fromDiscord = false, now?: number): Promise<void> {
  queue = queue
    .then(() => reconcile(fromDiscord, now))
    .catch((err) => logger.warn('[discord] looking-for-game sync failed', err));
  return queue;
}

let nudgeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * A game changed (`state`) or was deleted (null). Only a public table, or one
 * that already has a post, can change what the channel shows.
 */
export function nudgeLfgPosts(code: string, state: GameState | null): void {
  if (!lfgChannelId()) return;
  if (state?.visibility !== 'public' && !posted.has(code)) return;
  if (nudgeTimer) return;
  nudgeTimer = setTimeout(() => {
    nudgeTimer = null;
    void syncLfgPosts();
  }, NUDGE_DEBOUNCE_MS);
  nudgeTimer.unref?.();
}

/** Test seam: forget what this process has posted. */
export function resetLfgPostsForTests(): void {
  posted.clear();
  loaded = false;
  if (nudgeTimer) clearTimeout(nudgeTimer);
  nudgeTimer = null;
}
