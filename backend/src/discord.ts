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
 * Table channels are "Table 1", "Table 2", …: the lowest free number, never
 * the join code. Every member of the server sees every channel name, so a
 * code-named channel handed a private game's code to all of them. Which game
 * owns which channel is the `discord_channel_id` column on its session, so a
 * name carries nothing to match on.
 */
export function tableChannelName(n: number): string {
  return `${NAME_PREFIX}${n}`;
}

/** The number of a "Table N" channel, or null for any other name. */
export function tableNumber(name: string): number | null {
  const m = /^Table ([1-9]\d{0,3})$/.exec(name);
  return m ? Number(m[1]) : null;
}

/**
 * Whether a name in the category is one the bot made: "Table N", or a name
 * from before numbering (the join code, then a five-digit tag). The sweep may
 * remove these once no game owns them; anything else in the category it
 * leaves alone.
 */
export function isTableChannelName(name: string): boolean {
  return tableNumber(name) !== null || /^Table (\d{5}|[A-HJ-NP-Z2-9]{4})$/.test(name);
}

/**
 * Positions that list the tables in number order (Table 1, Table 2, …), with
 * any old code- or tag-named channel after them.
 */
export function tablePositions(channels: TableChannel[]): Array<{ id: string; position: number }> {
  const key = (ch: TableChannel) => tableNumber(ch.name) ?? Number.MAX_SAFE_INTEGER;
  return [...channels]
    .sort((a, b) => key(a) - key(b))
    .map((ch, position) => ({ id: ch.id, position }));
}

/** The lowest number no table channel is using. */
export function lowestFreeTable(names: string[]): number {
  const taken = new Set(names.map(tableNumber));
  let n = 1;
  while (taken.has(n)) n++;
  return n;
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
  name: string;
}

/** Every channel under the tables category that the bot made. */
export async function listTableChannels(): Promise<TableChannel[]> {
  const cfg = config();
  if (!cfg) return [];
  const channels = await call<Array<{ id: string; name: string; parent_id?: string | null }>>(
    cfg,
    'GET',
    `/guilds/${cfg.guildId}/channels`
  );
  return channels
    .filter((ch) => ch.parent_id === cfg.categoryId && isTableChannelName(ch.name))
    .map((ch) => ({ id: ch.id, name: ch.name }));
}

/**
 * A game's table: its existing channel when `channelId` still exists (a
 * second press, or a new host after a hand-off, lands in the same room),
 * otherwise a new "Table N". Returns the channel and a fresh invite. Throws
 * when unconfigured or when Discord refuses; the route turns that into a
 * message.
 */
export async function openTableChannel(
  channelId: string | null
): Promise<{ channelId: string; url: string }> {
  const cfg = config();
  if (!cfg) throw new Error('Discord tables are not configured.');
  const channels = await listTableChannels();
  let id = channelId && channels.find((ch) => ch.id === channelId)?.id;
  if (!id) {
    const name = tableChannelName(lowestFreeTable(channels.map((ch) => ch.name)));
    id = (
      await call<{ id: string }>(cfg, 'POST', `/guilds/${cfg.guildId}/channels`, {
        name,
        type: GUILD_VOICE,
        parent_id: cfg.categoryId,
      })
    ).id;
    // Discord adds a channel at the bottom of its category, so a refilled
    // Table 2 would sit under Table 4. Put every table back in number order.
    // Cosmetic: a failure here must not cost the host their table.
    try {
      await call(
        cfg,
        'PATCH',
        `/guilds/${cfg.guildId}/channels`,
        tablePositions([...channels, { id, name }])
      );
    } catch (err) {
      logger.warn('[discord] ordering the table channels failed', err);
    }
  }
  // A day matches the game session's own 24h lifetime; unlimited uses so a
  // spectator or a rejoin never finds the link spent.
  const invite = await call<{ code: string }>(cfg, 'POST', `/channels/${id}/invites`, {
    max_age: 24 * 60 * 60,
    max_uses: 0,
  });
  return { channelId: id, url: `https://discord.gg/${invite.code}` };
}

export async function deleteTableChannel(channelId: string): Promise<void> {
  const cfg = config();
  if (!cfg) return;
  await call(cfg, 'DELETE', `/channels/${channelId}`);
}

/**
 * Remove a table channel. Never throws: this runs from game teardown, which
 * must not fail because Discord is down; the periodic sweep gets whatever
 * this misses.
 */
export async function closeTableChannel(channelId: string): Promise<void> {
  if (!isDiscordConfigured()) return;
  try {
    await deleteTableChannel(channelId);
  } catch (err) {
    logger.warn(`[discord] closing table channel ${channelId} failed`, err);
  }
}

/**
 * The looking-for-game channel the bot posts open public tables in, or null
 * when it isn't set (the posting is off; the tables above still work).
 */
export function lfgChannelId(): string | null {
  return config() ? (process.env.DISCORD_LFG_CHANNEL_ID ?? null) : null;
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
