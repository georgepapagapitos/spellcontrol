import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeTableChannel,
  codeFromChannelName,
  isDiscordConfigured,
  tableChannelName,
} from './discord';

vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DISCORD_BOT_TOKEN;
  delete process.env.DISCORD_GUILD_ID;
  delete process.env.DISCORD_TABLES_CATEGORY_ID;
});

describe('table channel names', () => {
  it('round-trips a game code', () => {
    expect(codeFromChannelName(tableChannelName('TK7T'))).toBe('TK7T');
  });

  // The sweep deletes whatever this recognises, so a channel a moderator made
  // in the category must never parse as a table.
  it('recognises nothing else', () => {
    for (const name of [
      'Lounge',
      'Table',
      'Table tk7t',
      'Table TK7T2',
      'table TK7T',
      'Table TK-T',
    ]) {
      expect(codeFromChannelName(name), name).toBe(null);
    }
  });
});

describe('isDiscordConfigured', () => {
  it('needs the token, the server and the category', () => {
    process.env.DISCORD_BOT_TOKEN = 't';
    process.env.DISCORD_GUILD_ID = 'g';
    expect(isDiscordConfigured()).toBe(false);
    process.env.DISCORD_TABLES_CATEGORY_ID = 'c';
    expect(isDiscordConfigured()).toBe(true);
  });
});

describe('closeTableChannel', () => {
  it('makes no call when unconfigured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await closeTableChannel('TK7T');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never throws when Discord fails', async () => {
    process.env.DISCORD_BOT_TOKEN = 't';
    process.env.DISCORD_GUILD_ID = 'g';
    process.env.DISCORD_TABLES_CATEGORY_ID = 'c';
    vi.stubGlobal('fetch', async () => new Response('down', { status: 500 }));
    await expect(closeTableChannel('TK7T')).resolves.toBeUndefined();
  });
});
