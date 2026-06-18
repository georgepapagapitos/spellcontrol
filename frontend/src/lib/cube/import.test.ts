import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseCubeId,
  fetchCubeCobraCube,
  overlayOwnership,
  CubeImportError,
  CubeCobraCard,
} from './import';

describe('parseCubeId', () => {
  it('extracts the id from overview/list/playtest URLs', () => {
    expect(parseCubeId('https://cubecobra.com/cube/overview/Top540')).toBe('Top540');
    expect(parseCubeId('https://cubecobra.com/cube/list/31f')).toBe('31f');
    expect(parseCubeId('http://www.cubecobra.com/cube/playtest/abc?foo=1')).toBe('abc');
  });
  it('accepts a bare slug/id', () => {
    expect(parseCubeId('modovintage')).toBe('modovintage');
  });
  it('rejects junk', () => {
    expect(parseCubeId('')).toBeNull();
    expect(parseCubeId('not a url with spaces')).toBeNull();
  });
});

describe('fetchCubeCobraCube', () => {
  afterEach(() => vi.unstubAllGlobals());

  const cubeJson = {
    id: 'abc',
    name: 'Test Cube',
    cardCount: 2,
    likeCount: 7,
    cards: {
      mainboard: [
        // details-first card (no top-level fields)
        { details: { name: 'Sol Ring', type: 'Artifact', cmc: 1, colors: [], oracle_id: 'o-sol' } },
        // top-level card
        { name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', cmc: 1, colors: ['G'] },
        { name: '' }, // junk, dropped
      ],
    },
  };

  it('fetches and normalizes details-first and top-level cards', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => cubeJson })
    );
    const cube = await fetchCubeCobraCube('https://cubecobra.com/cube/overview/abc');
    expect(cube.name).toBe('Test Cube');
    expect(cube.cards.map((c) => c.name)).toEqual(['Sol Ring', 'Llanowar Elves']);
    expect(cube.cards[0].oracleId).toBe('o-sol');
    expect(cube.cards[1].colors).toEqual(['G']);
  });

  it('maps 404 / 429 / empty to friendly errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    );
    await expect(fetchCubeCobraCube('missing')).rejects.toBeInstanceOf(CubeImportError);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) })
    );
    await expect(fetchCubeCobraCube('busy')).rejects.toThrow(/rate-limit/i);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ cards: { mainboard: [] } }),
      })
    );
    await expect(fetchCubeCobraCube('empty')).rejects.toThrow(/empty/i);
  });

  it('rejects an unparseable link before fetching', async () => {
    await expect(fetchCubeCobraCube('has spaces')).rejects.toThrow(/CubeCobra cube link/i);
  });
});

describe('overlayOwnership', () => {
  const cards: CubeCobraCard[] = [
    { name: 'A', oracleId: '', cmc: 1, typeLine: '', colors: [] },
    { name: 'B', oracleId: '', cmc: 1, typeLine: '', colors: [] },
    { name: 'C', oracleId: '', cmc: 1, typeLine: '', colors: [] },
    { name: 'D', oracleId: '', cmc: 1, typeLine: '', colors: [] },
  ];
  it('counts owned / in-deck / missing and percent complete', () => {
    const own = (n: string) =>
      n === 'A' ? 'owned' : n === 'B' ? 'owned' : n === 'C' ? 'in-other-deck' : 'unowned';
    const o = overlayOwnership(cards, own);
    expect(o.owned).toBe(2);
    expect(o.inDeck).toBe(1);
    expect(o.missing).toBe(1);
    expect(o.pctComplete).toBeCloseTo(0.5);
    expect(o.rows).toHaveLength(4);
  });
});
