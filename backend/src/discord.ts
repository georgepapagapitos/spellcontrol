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

export function tableChannelName(code: string): string {
  return `${NAME_PREFIX}${code}`;
}

/** The game code a table channel was named for, or null for anything else. */
export function codeFromChannelName(name: string): string | null {
  if (!name.startsWith(NAME_PREFIX)) return null;
  const code = name.slice(NAME_PREFIX.length);
  return /^[A-Z0-9]{4}$/.test(code) ? code : null;
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
  code: string;
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
    const code = codeFromChannelName(ch.name);
    if (code) out.push({ id: ch.id, code });
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
  const existing = (await listTableChannels()).find((ch) => ch.code === code);
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
    const channel = (await listTableChannels()).find((ch) => ch.code === code);
    if (channel) await deleteTableChannel(channel.id);
  } catch (err) {
    logger.warn(`[discord] closing table ${code} failed`, err);
  }
}
