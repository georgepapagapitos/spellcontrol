import crypto from 'crypto';
import { logger } from './logger';

/**
 * Discord tables: a voice channel per online game, in the one SpellControl
 * Discord server, made on the host's request and removed when the game is
 * gone. No SDK and no gateway connection — the four REST calls below are the
 * whole integration, the same shape as `mail.ts`.
 *
 * Off unless all three env vars are set: the bot token (a Fly secret), the
 * server, and the category the tables live under. The category is also the
 * bot's fence: it lists, and deletes, only channels inside it.
 */
const API = 'https://discord.com/api/v10';

/** Voice channel, in Discord's channel-type enum. */
const GUILD_VOICE = 2;

const NAME_PREFIX = 'Table ';

interface Config {
  token: string;
  guildId: string;
  categoryId: string;
}

function config(): Config | null {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  const categoryId = process.env.DISCORD_TABLES_CATEGORY_ID;
  return token && guildId && categoryId ? { token, guildId, categoryId } : null;
}

export function isDiscordConfigured(): boolean {
  return config() !== null;
}

/**
 * The number a game's table channel is named by, never the join code itself:
 * every channel in the server is visible to every member, so "Table ZVVU"
 * handed anyone the code to a private game. A keyed hash of the code (the
 * bot token is the key) can't be turned back into it, and five digits can't
 * be typed into the four-character join box. The bot recomputes it from a
 * code to find a game's channel, so nothing extra is stored.
 */
export function tableTag(code: string): string {
  const key = process.env.DISCORD_BOT_TOKEN ?? '';
  const n = crypto.createHmac('sha256', key).update(code).digest().readUInt32BE(0);
  return String(n % 100_000).padStart(5, '0');
}

export function tableChannelName(code: string): string {
  return `${NAME_PREFIX}${tableTag(code)}`;
}

/**
 * The tag a table channel was named with, or null for anything else. A
 * four-character name is a channel from before tags (named by its join code):
 * no tag can equal one, so the sweep removes it as a table whose game is gone.
 * Only the join-code alphabet (no 0, 1, I or O), so a channel a moderator
 * named "Table 1234" is never mistaken for one.
 */
export function tagFromChannelName(name: string): string | null {
  if (!name.startsWith(NAME_PREFIX)) return null;
  const tag = name.slice(NAME_PREFIX.length);
  return /^(\d{5}|[A-HJ-NP-Z2-9]{4})$/.test(tag) ? tag : null;
}

async function call<T>(cfg: Config, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${cfg.token}`,
      'Content-Type': 'application/json',
      // Discord rejects bot requests without a DiscordBot user agent.
      'User-Agent': 'DiscordBot (https://spellcontrol.com, 1)',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Discord ${method} ${path} responded ${res.status} ${detail.slice(0, 200)}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export interface TableChannel {
  id: string;
  /** From the name; match a game with `tableTag(code)`. */
  tag: string;
}

/** Every table channel under the tables category. */
export async function listTableChannels(): Promise<TableChannel[]> {
  const cfg = config();
  if (!cfg) return [];
  const channels = await call<Array<{ id: string; name: string; parent_id?: string | null }>>(
    cfg,
    'GET',
    `/guilds/${cfg.guildId}/channels`
  );
  const out: TableChannel[] = [];
  for (const ch of channels) {
    if (ch.parent_id !== cfg.categoryId) continue;
    const tag = tagFromChannelName(ch.name);
    if (tag) out.push({ id: ch.id, tag });
  }
  return out;
}

/**
 * The invite link for `code`'s table, making the channel first if there is
 * none. Reuses an existing channel so a second press, or a second host after
 * a hand-off, lands everyone in the same room. Throws when unconfigured or
 * when Discord refuses; the route turns that into a message.
 */
export async function openTableChannel(code: string): Promise<string> {
  const cfg = config();
  if (!cfg) throw new Error('Discord tables are not configured.');
  const existing = (await listTableChannels()).find((ch) => ch.tag === tableTag(code));
  const channelId =
    existing?.id ??
    (
      await call<{ id: string }>(cfg, 'POST', `/guilds/${cfg.guildId}/channels`, {
        name: tableChannelName(code),
        type: GUILD_VOICE,
        parent_id: cfg.categoryId,
      })
    ).id;
  // A day matches the game session's own 24h lifetime; unlimited uses so a
  // spectator or a rejoin never finds the link spent.
  const invite = await call<{ code: string }>(cfg, 'POST', `/channels/${channelId}/invites`, {
    max_age: 24 * 60 * 60,
    max_uses: 0,
  });
  return `https://discord.gg/${invite.code}`;
}

export async function deleteTableChannel(channelId: string): Promise<void> {
  const cfg = config();
  if (!cfg) return;
  await call(cfg, 'DELETE', `/channels/${channelId}`);
}

/**
 * Remove `code`'s table if it has one. Never throws: this runs from game
 * teardown, which must not fail because Discord is down — the periodic sweep
 * gets whatever this misses.
 */
export async function closeTableChannel(code: string): Promise<void> {
  if (!isDiscordConfigured()) return;
  try {
    const channel = (await listTableChannels()).find((ch) => ch.tag === tableTag(code));
    if (channel) await deleteTableChannel(channel.id);
  } catch (err) {
    logger.warn(`[discord] closing table ${code} failed`, err);
  }
}

/**
 * The looking-for-game channel the bot posts open public tables in, or null
 * when it isn't set (the posting is off; the tables above still work).
 */
export function lfgChannelId(): string | null {
  return config() ? (process.env.DISCORD_LFG_CHANNEL_ID ?? null) : null;
}

/** The server's permanent invite, for the app's "Join the Discord" link. */
export function communityInviteUrl(): string | null {
  const url = process.env.DISCORD_INVITE_URL;
  return url && /^https:\/\/discord\.gg\/[A-Za-z0-9-]+$/.test(url) ? url : null;
}

/** A Discord message, as much of it as the posting needs. */
export interface ChannelMessage {
  id: string;
  author: { id: string };
  embeds?: Array<{ footer?: { text?: string } }>;
}

let botUserId: string | null = null;

/** The bot's own user id, so a listing keeps only the bot's messages. */
export async function botId(): Promise<string> {
  const cfg = config();
  if (!cfg) throw new Error('Discord is not configured.');
  botUserId ??= (await call<{ id: string }>(cfg, 'GET', '/users/@me')).id;
  return botUserId;
}

/** The bot's recent messages in a channel (the newest 100 are plenty). */
export async function listBotMessages(channelId: string): Promise<ChannelMessage[]> {
  const cfg = config();
  if (!cfg) return [];
  const me = await botId();
  const messages = await call<ChannelMessage[]>(
    cfg,
    'GET',
    `/channels/${channelId}/messages?limit=100`
  );
  return messages.filter((m) => m.author.id === me);
}

export async function postMessage(channelId: string, body: unknown): Promise<string> {
  const cfg = config();
  if (!cfg) throw new Error('Discord is not configured.');
  return (await call<{ id: string }>(cfg, 'POST', `/channels/${channelId}/messages`, body)).id;
}

export async function editMessage(channelId: string, id: string, body: unknown): Promise<void> {
  const cfg = config();
  if (!cfg) return;
  await call(cfg, 'PATCH', `/channels/${channelId}/messages/${id}`, body);
}

export async function deleteMessage(channelId: string, id: string): Promise<void> {
  const cfg = config();
  if (!cfg) return;
  await call(cfg, 'DELETE', `/channels/${channelId}/messages/${id}`);
}
