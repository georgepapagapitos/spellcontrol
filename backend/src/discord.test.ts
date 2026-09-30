import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeTableChannel,
  isDiscordConfigured,
  tableChannelName,
  tableTag,
  tagFromChannelName,
} from './discord';

vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DISCORD_BOT_TOKEN;
  delete process.env.DISCORD_GUILD_ID;
  delete process.env.DISCORD_TABLES_CATEGORY_ID;
});

describe('table channel names', () => {
  // Every member of the server sees every channel name, so a name that held
  // the join code would open a private table to all of them.
  it('never names a channel by its join code', () => {
    process.env.DISCORD_BOT_TOKEN = 'secret';
    for (const code of ['TK7T', 'ZVVU', '2345', 'ABCD']) {
      const name = tableChannelName(code);
      expect(name, code).toMatch(/^Table \d{5}$/);
      expect(name, code).not.toContain(code);
    }
  });

  it('is stable for a code, differs across codes, and depends on the secret', () => {
    process.env.DISCORD_BOT_TOKEN = 'secret';
    expect(tableTag('TK7T')).toBe(tableTag('TK7T'));
    expect(tableTag('TK7T')).not.toBe(tableTag('TK7U'));
    const withSecret = tableTag('TK7T');
    process.env.DISCORD_BOT_TOKEN = 'another';
    expect(tableTag('TK7T')).not.toBe(withSecret);
  });

  it('reads back the tag, and an old code-named channel so the sweep can clear it', () => {
    process.env.DISCORD_BOT_TOKEN = 'secret';
    expect(tagFromChannelName(tableChannelName('TK7T'))).toBe(tableTag('TK7T'));
    expect(tagFromChannelName('Table ZVVU')).toBe('ZVVU');
  });

  // The sweep deletes whatever this recognises, so a channel a moderator made
  // in the category must never parse as a table.
  it('recognises nothing else', () => {
    for (const name of [
      'Lounge',
      'Table',
      'Table tk7t',
      'Table TK7T2',
      'Table 1234',
      'Table 123456',
      'table 12345',
      'Table TK-T',
    ]) {
      expect(tagFromChannelName(name), name).toBe(null);
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
