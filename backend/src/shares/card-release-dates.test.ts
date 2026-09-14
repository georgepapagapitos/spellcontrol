import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { EnrichedCard } from '@spellcontrol/binder-routing';
import { releaseDateOf } from '@spellcontrol/binder-routing';
import { ScryfallCache } from '../cache';
import type { ScryfallCard } from '../types';

let dir: string;

function printing(id: string, releasedAt?: string): ScryfallCard {
  return {
    id,
    name: 'Arcane Signet',
    set: 'slp',
    set_name: 'Secret Lair Promo',
    collector_number: id,
    rarity: 'rare',
    released_at: releasedAt,
  };
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'release-dates-'));
  // `getScryfallCache()` resolves DB_PATH at import time, so this must be set
  // before the module under test is imported (hence the dynamic imports below).
  process.env.DB_PATH = path.join(dir, 'scryfall-cache.db');
  const seed = new ScryfallCache(process.env.DB_PATH);
  seed.setMany([printing('sf-1', '2026-09-11'), printing('sf-2')]);
  seed.close();
});

afterAll(() => {
  delete process.env.DB_PATH;
  rmSync(dir, { recursive: true, force: true });
});

function card(scryfallId: string): EnrichedCard {
  return {
    copyId: scryfallId,
    name: 'Arcane Signet',
    setCode: 'SLP',
    setName: 'Secret Lair Promo',
    collectorNumber: '1',
    rarity: 'rare',
    scryfallId,
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
  };
}

describe('card-release-dates', () => {
  it('stamps the cached printing date and leaves uncached printings alone', async () => {
    const { decorateCardsWithReleaseDates } = await import('./card-release-dates');
    const out = decorateCardsWithReleaseDates([card('sf-1'), card('sf-2'), card('sf-missing')]);
    expect(out[0].releasedAt).toBe('2026-09-11');
    // Cached, but Scryfall gave the printing no date — must stay absent rather
    // than become '', which would beat the set-date fallback with nothing.
    expect(out[1].releasedAt).toBeUndefined();
    expect(out[2].releasedAt).toBeUndefined();
  });

  // The divergence this module exists to prevent: the owner's view dates each
  // printing individually, so a shared view that dated from the SET would order
  // a rolling container set differently from what the owner sleeved.
  it('gives the shared view the same date the owner sorts by', async () => {
    const { decorateCardsWithReleaseDates } = await import('./card-release-dates');
    const setMap = {
      SLP: { code: 'SLP', name: 'Secret Lair Promo', iconSvgUri: '', releasedAt: '2023-02-17' },
    };
    const [decorated] = decorateCardsWithReleaseDates([card('sf-1')]);
    expect(releaseDateOf(decorated, setMap)).toBe('2026-09-11');
    expect(releaseDateOf(card('sf-1'), setMap)).toBe('2023-02-17');
  });

  it('returns the input untouched when no card has a scryfallId', async () => {
    const { decorateCardsWithReleaseDates } = await import('./card-release-dates');
    const cards = [{ ...card('sf-1'), scryfallId: '' }];
    expect(decorateCardsWithReleaseDates(cards)).toBe(cards);
  });

  it('anyBinderUsesReleaseDateSort gates on the release-date sort only', async () => {
    const { anyBinderUsesReleaseDateSort } = await import('./card-release-dates');
    expect(anyBinderUsesReleaseDateSort([{ sorts: [{ field: 'setReleaseDate' }] }])).toBe(true);
    expect(anyBinderUsesReleaseDateSort([{ sorts: [{ field: 'color' }] }])).toBe(false);
    // A set-NAME sort needs no date — a printing's date can't change its set.
    expect(anyBinderUsesReleaseDateSort([{ sorts: [{ field: 'setName' }] }])).toBe(false);
    expect(anyBinderUsesReleaseDateSort('nope')).toBe(false);
  });
});
