import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCardRulings } from './card-rulings';

const ID = '00000000-0000-0000-0000-000000000001';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCardRulings', () => {
  it('returns the rulings array and memoizes per id', async () => {
    const rulings = [{ published_at: '2020-01-01', comment: 'It works.', source: 'wotc' }];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rulings }) });
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchCardRulings(ID)).toEqual(rulings);
    await fetchCardRulings(ID); // second call served from cache
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws and evicts on a failed response so a retry can refetch', async () => {
    const id = '00000000-0000-0000-0000-000000000002';
    const bad = vi.fn().mockResolvedValue({ ok: false, status: 502 });
    vi.stubGlobal('fetch', bad);
    await expect(fetchCardRulings(id)).rejects.toThrow('502');

    const good = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rulings: [] }) });
    vi.stubGlobal('fetch', good);
    expect(await fetchCardRulings(id)).toEqual([]); // not stuck on the cached rejection
    expect(good).toHaveBeenCalledTimes(1);
  });
});
