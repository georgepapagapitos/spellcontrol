import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeTableChannel,
  isDiscordConfigured,
  isTableChannelName,
  lowestFreeTable,
  tableChannelName,
  tableNumber,
  tablePositions,
} from './discord';

vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DISCORD_BOT_TOKEN;
  delete process.env.DISCORD_GUILD_ID;
  delete process.env.DISCORD_TABLES_CATEGORY_ID;
});

describe('table channel names', () => {
  // Every member of the server sees every channel name, so a table is only
  // ever a number: never its join code, which would open a private game to
  // the whole server.
  it('names a table by its number', () => {
    expect(tableChannelName(1)).toBe('Table 1');
    expect(tableNumber('Table 1')).toBe(1);
    expect(tableNumber('Table 12')).toBe(12);
  });

  it('orders tables by number, old-style names last', () => {
    expect(
      tablePositions([
        { id: 'c', name: 'Table 3' },
        { id: 'z', name: 'Table ZVVU' },
        { id: 'a', name: 'Table 1' },
        { id: 'b', name: 'Table 2' },
      ])
    ).toEqual([
      { id: 'a', position: 0 },
      { id: 'b', position: 1 },
      { id: 'c', position: 2 },
      { id: 'z', position: 3 },
    ]);
  });

  it('takes the lowest free number', () => {
    expect(lowestFreeTable([])).toBe(1);
    expect(lowestFreeTable(['Table 1', 'Table 3'])).toBe(2);
    expect(lowestFreeTable(['Table 2', 'Table 1'])).toBe(3);
    // An old code- or tag-named channel holds no number.
    expect(lowestFreeTable(['Table ZVVU', 'Table 48213'])).toBe(1);
  });

  it('knows the old code- and tag-named channels as its own, so the sweep can clear them', () => {
    for (const name of ['Table 1', 'Table 40', 'Table ZVVU', 'Table 48213']) {
      expect(isTableChannelName(name), name).toBe(true);
    }
  });

  // The sweep deletes what this recognizes, so a channel a moderator made in
  // the category must never read as a table.
  it('recognizes nothing else', () => {
    for (const name of [
      'Lounge',
      'Table',
      'Table 0',
      'Table 01',
      'Table tk7t',
      'Table TK7T2',
      'Table 123456',
      'table 12',
      'Table TK-T',
      'Table 1 overflow',
    ]) {
      expect(isTableChannelName(name), name).toBe(false);
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
