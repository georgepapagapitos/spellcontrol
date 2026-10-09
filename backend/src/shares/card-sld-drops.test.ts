import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { EnrichedCard } from '@spellcontrol/binder-routing';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'sld-drops-'));
  writeFileSync(
    path.join(dir, 'sld-drops.json'),
    JSON.stringify({
      drops: [
        { name: 'Goblin Storm', releasedAt: '2026-05-22', numbers: ['2418', '2419'] },
        { name: 'Undated Promo', releasedAt: '', numbers: ['923'] },
        // SLD #523, newest first, as the real snapshot lists it.
        { name: 'Year of the Rat', releasedAt: '2020-01-07', numbers: ['523'] },
        { name: 'Kaleidoscope Killers', releasedAt: '2019-12-08', numbers: ['523'] },
      ],
    })
  );
  process.env.SLD_DROPS_SNAPSHOT_PATH = path.join(dir, 'sld-drops.json');
});

afterAll(() => {
  delete process.env.SLD_DROPS_SNAPSHOT_PATH;
  rmSync(dir, { recursive: true, force: true });
});

function card(setCode: string, collectorNumber: string): EnrichedCard {
  return {
    copyId: `${setCode}-${collectorNumber}`,
    name: 'Mountain',
    setCode,
    setName: setCode === 'SLD' ? 'Secret Lair Drop' : 'Other',
    collectorNumber,
    rarity: 'common',
    scryfallId: `${setCode}-${collectorNumber}`,
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
  };
}

describe('card-sld-drops', () => {
  it('stamps mapped SLD numbers (and suffixed variants) with their drop, leaves the rest alone', async () => {
    const { decorateCardsWithSldDrops, resetSldDropsCache } = await import('./card-sld-drops');
    resetSldDropsCache();
    const out = decorateCardsWithSldDrops([
      card('SLD', '2418'),
      card('SLD', '2419★'),
      card('SLD', '923'),
      card('SLD', '7130'),
      card('M21', '2418'),
    ]);
    expect(out[0].sldDrop).toBe('Goblin Storm');
    expect(out[0].sldDropReleasedAt).toBe('2026-05-22');
    expect(out[1].sldDrop).toBe('Goblin Storm');
    expect(out[2].sldDrop).toBe('Undated Promo');
    expect(out[2].sldDropReleasedAt).toBe('');
    expect(out[3].sldDrop).toBeUndefined();
    expect(out[4].sldDrop).toBeUndefined();
  });

  it('picks the same drop as the frontend for a number sold in several (parity fixture)', async () => {
    // Same fixture and answers as frontend/src/lib/cards/sld-drops.test.ts: both
    // call binder-routing's pickClosestDrop, so a drift in either shows up as a diff.
    const { decorateCardsWithSldDrops, resetSldDropsCache } = await import('./card-sld-drops');
    resetSldDropsCache();
    const dated = { ...card('SLD', '523'), releasedAt: '2019-12-16' };
    const [ral, undated] = decorateCardsWithSldDrops([dated, card('SLD', '523')]);
    expect(ral.sldDrop).toBe('Kaleidoscope Killers');
    expect(ral.sldDropReleasedAt).toBe('2019-12-08');
    expect(undated.sldDrop).toBe('Year of the Rat');
  });

  it('anyBinderUsesSetSorts gates on either set sort or the retired sldDrop field', async () => {
    const { anyBinderUsesSetSorts } = await import('./card-sld-drops');
    expect(anyBinderUsesSetSorts([{ sorts: [{ field: 'color' }] }])).toBe(false);
    expect(anyBinderUsesSetSorts([{ sorts: [{ field: 'setReleaseDate' }] }])).toBe(true);
    expect(anyBinderUsesSetSorts([{ sorts: [{ field: 'sldDrop' }] }])).toBe(true);
    expect(anyBinderUsesSetSorts('nope')).toBe(false);
  });
});
