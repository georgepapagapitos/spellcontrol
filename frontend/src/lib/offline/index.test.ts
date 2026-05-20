import 'fake-indexeddb/auto';
import { afterEach, describe, it, expect } from 'vitest';
import {
  clearOfflineData,
  offlineDataAvailable,
  offlineGetCardByName,
  offlineGetCardByOracleId,
  offlineGetCardsByNames,
  offlineGetCardsByOracleIds,
  offlineGetManifest,
  offlineSearchCards,
} from './index';
import { replaceOracleCards, writeManifest } from './db';
import type { SlimCard } from './types';

function slim(oracleId: string, name: string, overrides: Partial<SlimCard> = {}): SlimCard {
  return {
    oracleId,
    scryfallId: `s-${oracleId}`,
    name,
    cmc: 2,
    typeLine: 'Instant',
    colors: ['U'],
    colorIdentity: ['U'],
    keywords: [],
    legalities: { commander: 'legal' },
    set: 'tst',
    ...overrides,
  };
}

afterEach(async () => {
  await clearOfflineData();
});

describe('offlineDataAvailable', () => {
  it('is false until a manifest with cards has been written', async () => {
    expect(await offlineDataAvailable()).toBe(false);
    await writeManifest({
      oracleVersion: 'v1',
      oracleCardCount: 100,
      oracleByteSize: 0,
      oracleUpdatedAt: 0,
      combosVersion: 'v',
      combosCount: 0,
      combosByteSize: 0,
      combosUpdatedAt: 0,
    });
    expect(await offlineDataAvailable()).toBe(true);
  });

  it('returns false if manifest exists but card count is 0', async () => {
    await writeManifest({
      oracleVersion: 'v1',
      oracleCardCount: 0,
      oracleByteSize: 0,
      oracleUpdatedAt: 0,
      combosVersion: 'v',
      combosCount: 0,
      combosByteSize: 0,
      combosUpdatedAt: 0,
    });
    expect(await offlineDataAvailable()).toBe(false);
  });
});

describe('lookup wrappers inflate slim → ScryfallCard', () => {
  it('offlineGetCardByName inflates to scryfall shape', async () => {
    await replaceOracleCards([slim('o-counter', 'Counterspell', { manaCost: '{U}{U}' })]);
    const card = await offlineGetCardByName('Counterspell');
    expect(card?.id).toBe('s-o-counter');
    expect(card?.mana_cost).toBe('{U}{U}');
    expect(card?.color_identity).toEqual(['U']);
  });

  it('offlineGetCardByName returns null when not found', async () => {
    expect(await offlineGetCardByName('Unknown')).toBeNull();
  });

  it('offlineGetCardByOracleId resolves by oracle id', async () => {
    await replaceOracleCards([slim('o-x', 'X')]);
    expect((await offlineGetCardByOracleId('o-x'))?.name).toBe('X');
    expect(await offlineGetCardByOracleId('missing')).toBeNull();
  });

  it('offlineGetCardsByNames batches', async () => {
    await replaceOracleCards([slim('o-a', 'A'), slim('o-b', 'B')]);
    const result = await offlineGetCardsByNames(['A', 'B', 'missing']);
    expect(result.size).toBe(2);
    expect(result.get('A')?.id).toBe('s-o-a');
  });

  it('offlineGetCardsByOracleIds batches', async () => {
    await replaceOracleCards([slim('o-a', 'A'), slim('o-b', 'B')]);
    const result = await offlineGetCardsByOracleIds(['o-a', 'o-b', 'missing']);
    expect(result.size).toBe(2);
  });

  it('offlineGetManifest returns whatever was written', async () => {
    expect(await offlineGetManifest()).toBeNull();
    await writeManifest({
      oracleVersion: 'v',
      oracleCardCount: 1,
      oracleByteSize: 0,
      oracleUpdatedAt: 0,
      combosVersion: 'v',
      combosCount: 0,
      combosByteSize: 0,
      combosUpdatedAt: 0,
    });
    expect(await offlineGetManifest()).not.toBeNull();
  });
});

describe('offlineSearchCards', () => {
  it('filters by query and color identity', async () => {
    await replaceOracleCards([
      slim('o-ub', 'Counterspell', { colorIdentity: ['U'], typeLine: 'Instant' }),
      slim('o-r', 'Lightning Bolt', { colorIdentity: ['R'], typeLine: 'Instant' }),
      slim('o-g', 'Llanowar Elves', {
        colorIdentity: ['G'],
        typeLine: 'Creature — Elf Druid',
        cmc: 1,
      }),
    ]);
    const resp = await offlineSearchCards('t:instant', { colorIdentity: ['U'] });
    expect(resp.data.map((c) => c.name).sort()).toEqual(['Counterspell']);
  });

  it('paginates and reports has_more correctly', async () => {
    // 200 cards so pagination kicks in (PAGE_SIZE=175)
    const cards = Array.from({ length: 200 }, (_, i) =>
      slim(`o-${i}`, `Card ${String(i).padStart(3, '0')}`)
    );
    await replaceOracleCards(cards);
    const page1 = await offlineSearchCards('t:instant', {
      skipColorFilter: true,
      order: 'name',
      page: 1,
    });
    expect(page1.data.length).toBe(175);
    expect(page1.has_more).toBe(true);
    const page2 = await offlineSearchCards('t:instant', {
      skipColorFilter: true,
      order: 'name',
      page: 2,
    });
    expect(page2.data.length).toBe(25);
    expect(page2.has_more).toBe(false);
  });

  it('honors cmc and edhrec sort orders', async () => {
    await replaceOracleCards([
      slim('o-a', 'A', { cmc: 5, edhrecRank: 100 }),
      slim('o-b', 'B', { cmc: 1, edhrecRank: 5 }),
      slim('o-c', 'C', { cmc: 3, edhrecRank: 50 }),
    ]);
    const byCmc = await offlineSearchCards('t:instant', { skipColorFilter: true, order: 'cmc' });
    expect(byCmc.data.map((c) => c.name)).toEqual(['B', 'C', 'A']);
    const byEdh = await offlineSearchCards('t:instant', { skipColorFilter: true, order: 'edhrec' });
    expect(byEdh.data.map((c) => c.name)).toEqual(['B', 'C', 'A']);
  });

  it('respects skipFormatFilter', async () => {
    await replaceOracleCards([
      slim('o-legal', 'Legal', { legalities: { commander: 'legal' } }),
      slim('o-banned', 'Banned', { legalities: { commander: 'banned' } }),
    ]);
    const default_ = await offlineSearchCards('t:instant', { skipColorFilter: true });
    expect(default_.data.map((c) => c.name)).toEqual(['Legal']);
    const noFmt = await offlineSearchCards('t:instant', {
      skipColorFilter: true,
      skipFormatFilter: true,
    });
    expect(noFmt.data.map((c) => c.name).sort()).toEqual(['Banned', 'Legal']);
  });
});
