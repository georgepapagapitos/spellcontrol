// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Fresh module state per test (the loader caches for the session).
beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('cardSimilar loader', () => {
  it('loads the index and exposes 0-based similar ranks', async () => {
    const data = {
      generatedAt: 'test',
      similar: { 'Sol Ring': ['Mana Vault', 'Mind Stone', 'Fellwar Stone'] },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => data }))
    );
    const { loadCardSimilar, getSimilarRank, hasCardSimilar } = await import('./cardSimilar');

    const res = await loadCardSimilar();
    expect(res).not.toBeNull();
    expect(hasCardSimilar()).toBe(true);

    const ranks = getSimilarRank('Sol Ring');
    expect(ranks?.get('Mana Vault')).toBe(0);
    expect(ranks?.get('Mind Stone')).toBe(1);
    expect(ranks?.get('Fellwar Stone')).toBe(2);
    expect(getSimilarRank('Not Indexed')).toBeNull(); // unindexed card
  });

  it('returns null and stays unloaded when the snapshot is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
    );
    const { loadCardSimilar, getSimilarRank, hasCardSimilar } = await import('./cardSimilar');

    const res = await loadCardSimilar();
    expect(res).toBeNull();
    expect(hasCardSimilar()).toBe(false);
    expect(getSimilarRank('Sol Ring')).toBeNull(); // → finder falls back to heuristic
  });

  it('dedups repeated similar names, keeping the best (lowest) rank', async () => {
    const data = {
      generatedAt: 'test',
      similar: { 'Sol Ring': ['Mind Stone', 'Mana Vault', 'Mind Stone'] },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => data }))
    );
    const { loadCardSimilar, getSimilarRank } = await import('./cardSimilar');
    await loadCardSimilar();
    expect(getSimilarRank('Sol Ring')?.get('Mind Stone')).toBe(0); // first occurrence wins
  });
});

// Guards the SHIPPED data file (public/card-similar.json), so a broken/empty
// refresh can't silently degrade every substitute suggestion to the heuristic.
describe('shipped card-similar.json', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const shipped = JSON.parse(
    readFileSync(resolve(here, '..', '..', '..', '..', 'public', 'card-similar.json'), 'utf8')
  ) as { count: number; similar: Record<string, string[]> };
  const fixture = JSON.parse(
    readFileSync(resolve(here, '__fixtures__', 'edhrec-similar.fixture.json'), 'utf8')
  ) as { similar: Record<string, string[]> };

  it('is substantial (the BFS walk actually populated it)', () => {
    expect(shipped.count).toBeGreaterThanOrEqual(500);
    expect(Object.keys(shipped.similar).length).toBe(shipped.count);
  });

  it('every entry has a non-empty similar list', () => {
    const empty = Object.entries(shipped.similar).filter(([, v]) => !Array.isArray(v) || !v.length);
    expect(empty).toEqual([]);
  });

  it('covers the real staples (most fixture seeds are indexed)', () => {
    const seeds = Object.keys(fixture.similar);
    const covered = seeds.filter((n) => shipped.similar[n]);
    // Both the index and the eval fixture are seeded from staples, so coverage
    // should be high; 0.6 leaves slack for EDHREC churn between refreshes.
    expect(covered.length / seeds.length).toBeGreaterThanOrEqual(0.6);
  });
});
