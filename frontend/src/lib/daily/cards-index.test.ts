import { afterEach, describe, it, expect, vi } from 'vitest';
import { buildCardIndex, fold, loadCardIndex, resetCardIndexCache } from './cards-index';

const file = {
  version: 1,
  generatedAt: '2026-10-01T00:00:00.000Z',
  rarities: ['common', 'uncommon', 'rare', 'mythic', 'special'],
  cards: [
    ['Fire // Ice', 'UR', 4, 'Instant // Instant', 1, 2001],
    ['Lightning Bolt', 'R', 1, 'Instant', 0, 1993],
    ['Lightning Greaves', '', 2, 'Artifact — Equipment', 1, 2004],
    ['Chain Lightning', 'R', 1, 'Sorcery', 0, 1994],
    ['Lim-Dûl the Necromancer', 'B', 7, 'Legendary Creature — Human Wizard', 2, 1996],
  ] as [string, string, number, string, number, number][],
};

afterEach(() => {
  vi.unstubAllGlobals();
  resetCardIndexCache();
});

describe('fold', () => {
  it('lower-cases and strips accents', () => {
    expect(fold('  Lim-Dûl ')).toBe('lim-dul');
  });
});

describe('buildCardIndex', () => {
  const index = buildCardIndex(file);

  it('looks cards up by full name, any case, or by one face', () => {
    expect(index.get('lightning bolt')).toMatchObject({
      name: 'Lightning Bolt',
      rarity: 'common',
      year: 1993,
    });
    expect(index.get('Ice')?.name).toBe('Fire // Ice');
    expect(index.get('lim-dul the necromancer')?.rarity).toBe('rare');
    expect(index.get('Nope')).toBeUndefined();
    expect(index.size).toBe(5);
  });

  it('suggests prefix matches before matches inside the name', () => {
    expect(index.suggest('light')).toEqual([
      'Lightning Bolt',
      'Lightning Greaves',
      'Chain Lightning',
    ]);
    expect(index.suggest('ice')).toEqual(['Fire // Ice']);
    expect(index.suggest('lim-dul')).toEqual(['Lim-Dûl the Necromancer']);
  });

  it('waits for two characters and respects the limit', () => {
    expect(index.suggest('l')).toEqual([]);
    expect(index.suggest('light', 1)).toEqual(['Lightning Bolt']);
  });
});

describe('loadCardIndex', () => {
  it('fetches once, and refetches after a failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
      .mockResolvedValue(new Response(JSON.stringify(file)));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadCardIndex()).rejects.toThrow("Couldn't load the card list.");
    const index = await loadCardIndex();
    await loadCardIndex();
    expect(index.size).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
