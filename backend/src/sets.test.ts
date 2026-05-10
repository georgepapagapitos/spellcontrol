import { describe, it, expect, vi, beforeEach } from 'vitest';

async function freshModule() {
  vi.resetModules();
  return import('./sets');
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('getSetMap', () => {
  it('returns an upper-cased, normalized map keyed by set code', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { code: 'cmr', name: 'Commander Legends', icon_svg_uri: 'a.svg' },
            { code: 'rna', name: 'Ravnica Allegiance', icon_svg_uri: 'b.svg' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const { getSetMap } = await freshModule();
    const map = await getSetMap();
    expect(map.CMR.name).toBe('Commander Legends');
    expect(map.CMR.iconSvgUri).toBe('a.svg');
    expect(map.RNA.code).toBe('RNA');
  });

  it('caches the response across calls within the TTL', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ object: 'list', data: [] }), { status: 200 })
      );
    const { getSetMap } = await freshModule();
    await getSetMap();
    await getSetMap();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('shares an in-flight request across concurrent callers', async () => {
    let resolveFetch!: (v: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolveFetch = r;
    });
    const fetchSpy = vi.spyOn(global, 'fetch').mockReturnValue(pending);
    const { getSetMap } = await freshModule();
    const a = getSetMap();
    const b = getSetMap();
    resolveFetch(new Response(JSON.stringify({ object: 'list', data: [] }), { status: 200 }));
    await Promise.all([a, b]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('throws and clears in-flight on a non-OK response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const { getSetMap } = await freshModule();
    await expect(getSetMap()).rejects.toThrow(/HTTP 500/);
  });
});
