import { afterEach, describe, it, expect, vi } from 'vitest';
import { buildNames, fold, loadDailyNames, resetDailyNamesCache } from './names';

const NAMES = [
  'Chain Lightning',
  'Fire // Ice',
  'Lightning Bolt',
  'Lightning Greaves',
  'Lim-Dûl the Necromancer',
];

afterEach(() => {
  vi.unstubAllGlobals();
  resetDailyNamesCache();
});

describe('fold', () => {
  it('lower-cases and strips accents', () => {
    expect(fold('  Lim-Dûl ')).toBe('lim-dul');
  });
});

describe('buildNames', () => {
  const names = buildNames(NAMES);

  it('suggests prefix matches before matches inside the name, faces included', () => {
    expect(names.suggest('light')).toEqual([
      'Lightning Bolt',
      'Lightning Greaves',
      'Chain Lightning',
    ]);
    expect(names.suggest('ice')).toEqual(['Fire // Ice']);
    expect(names.suggest('lim-dul')).toEqual(['Lim-Dûl the Necromancer']);
    expect(names.size).toBe(5);
  });

  it('waits for two characters and respects the limit', () => {
    expect(names.suggest('l')).toEqual([]);
    expect(names.suggest('light', 1)).toEqual(['Lightning Bolt']);
  });
});

describe('loadDailyNames', () => {
  it('fetches once, and refetches after a failure', async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
      .mockResolvedValue(new Response(JSON.stringify({ version: 1, names: NAMES })));
    vi.stubGlobal('fetch', fn);
    await expect(loadDailyNames()).rejects.toThrow("Couldn't load the card list.");
    const names = await loadDailyNames();
    await loadDailyNames();
    expect(names.size).toBe(5);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
