import 'fake-indexeddb/auto';
import { afterEach, describe, it, expect } from 'vitest';
import {
  clearOfflineData,
  getAllCombos,
  getCardByName,
  getCardByOracleId,
  getCardsByOracleIds,
  getOfflineDataStats,
  iterateAllCards,
  readManifest,
  replaceCombos,
  replaceOracleCards,
  writeManifest,
} from './db';
import type { OfflineCombo, OfflineManifest, SlimCard } from './types';

function slim(oracleId: string, name: string, overrides: Partial<SlimCard> = {}): SlimCard {
  return {
    oracleId,
    scryfallId: `s-${oracleId}`,
    name,
    cmc: 0,
    typeLine: 'Artifact',
    colors: [],
    colorIdentity: [],
    keywords: [],
    legalities: { commander: 'legal' },
    set: 'tst',
    ...overrides,
  };
}

afterEach(async () => {
  await clearOfflineData();
});

describe('replaceOracleCards', () => {
  it('replaces existing cards on second call (does not accumulate)', async () => {
    await replaceOracleCards([slim('o1', 'Alpha'), slim('o2', 'Beta')]);
    expect((await getOfflineDataStats()).cardCount).toBe(2);

    await replaceOracleCards([slim('o3', 'Gamma')]);
    const stats = await getOfflineDataStats();
    expect(stats.cardCount).toBe(1);
    expect(await getCardByName('Alpha')).toBeNull();
    expect(await getCardByName('Gamma')).not.toBeNull();
  });

  it('indexes DFC front-face names so split lookups resolve', async () => {
    await replaceOracleCards([
      slim('o-dfc', 'Bruna, the Fading Light // Brisela, Voice of Nightmares', {
        faces: [{ name: 'Bruna, the Fading Light' }, { name: 'Gisela, the Broken Blade' }],
      }),
    ]);
    expect(await getCardByName('Bruna, the Fading Light')).not.toBeNull();
    // Full-name still resolves too.
    expect(
      await getCardByName('Bruna, the Fading Light // Brisela, Voice of Nightmares')
    ).not.toBeNull();
  });

  it('reports progress in batches', async () => {
    const cards = Array.from({ length: 2500 }, (_, i) => slim(`o${i}`, `Card ${i}`));
    const progressEvents: Array<[number, number]> = [];
    await replaceOracleCards(cards, (done, total) => progressEvents.push([done, total]));
    expect(progressEvents.length).toBeGreaterThan(1);
    expect(progressEvents.at(-1)).toEqual([2500, 2500]);
  });
});

describe('lookups', () => {
  it('resolves by oracle id', async () => {
    await replaceOracleCards([slim('o1', 'Sol Ring')]);
    const card = await getCardByOracleId('o1');
    expect(card?.name).toBe('Sol Ring');
    expect(await getCardByOracleId('missing')).toBeNull();
  });

  it('resolves by name case-insensitively', async () => {
    await replaceOracleCards([slim('o1', 'Sol Ring')]);
    expect((await getCardByName('SOL RING'))?.oracleId).toBe('o1');
  });

  it('batch resolves by oracle id (skipping missing)', async () => {
    await replaceOracleCards([slim('o1', 'A'), slim('o2', 'B')]);
    const result = await getCardsByOracleIds(['o1', 'o2', 'missing']);
    expect(result.size).toBe(2);
    expect(result.get('o1')?.name).toBe('A');
  });

  it('iterates every card', async () => {
    await replaceOracleCards([slim('o1', 'A'), slim('o2', 'B'), slim('o3', 'C')]);
    const names: string[] = [];
    for await (const card of iterateAllCards()) names.push(card.name);
    expect(names.sort()).toEqual(['A', 'B', 'C']);
  });
});

describe('combos store', () => {
  it('replaces combos on second call', async () => {
    const c: OfflineCombo = {
      id: 'c1',
      identity: 'W',
      produces: [],
      prerequisites: null,
      description: null,
      manaNeeded: null,
      popularity: 0,
      legalities: { commander: 'legal' },
      cardCount: 1,
      bracket: null,
      cards: [{ oracleId: 'o1', cardName: 'Card', quantity: 1, position: 0 }],
    };
    await replaceCombos([c]);
    expect((await getAllCombos()).length).toBe(1);
    await replaceCombos([]);
    expect((await getAllCombos()).length).toBe(0);
  });
});

describe('manifest', () => {
  it('round-trips through writeManifest/readManifest', async () => {
    expect(await readManifest()).toBeNull();
    const m: OfflineManifest = {
      oracleVersion: 'v1',
      oracleCardCount: 100,
      oracleByteSize: 12345,
      oracleUpdatedAt: 1000,
      combosVersion: 'cv1',
      combosCount: 5,
      combosByteSize: 678,
      combosUpdatedAt: 2000,
    };
    await writeManifest(m);
    expect(await readManifest()).toEqual(m);
  });
});

describe('clearOfflineData', () => {
  it('wipes cards, combos, and manifest', async () => {
    await replaceOracleCards([slim('o1', 'A')]);
    await writeManifest({
      oracleVersion: 'v',
      oracleCardCount: 1,
      oracleByteSize: 1,
      oracleUpdatedAt: 1,
      combosVersion: 'v',
      combosCount: 0,
      combosByteSize: 0,
      combosUpdatedAt: 0,
    });
    await clearOfflineData();
    expect((await getOfflineDataStats()).cardCount).toBe(0);
    expect(await readManifest()).toBeNull();
  });
});
