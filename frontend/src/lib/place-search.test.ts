import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mapsSearchUrl, searchPlaces } from './place-search';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('searchPlaces', () => {
  it('formats hits as "name, number street, city, state" and dedupes', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        features: [
          {
            properties: {
              name: 'The Game Shop',
              housenumber: '12',
              street: 'Main St',
              city: 'Madison',
              state: 'Wisconsin',
            },
          },
          { properties: { name: 'Madison', state: 'Wisconsin' } },
          { properties: { name: 'Madison', state: 'Wisconsin' } }, // dupe collapses
          { properties: {} }, // empty hit dropped
        ],
      })
    );
    const labels = await searchPlaces('madison');
    expect(labels).toEqual(['The Game Shop, 12 Main St, Madison, Wisconsin', 'Madison, Wisconsin']);
    expect(String(fetchMock.mock.calls[0][0])).toContain('photon.komoot.io');
    expect(String(fetchMock.mock.calls[0][0])).toContain('q=madison');
  });

  it('skips the network entirely for short queries', async () => {
    expect(await searchPlaces('  ab ')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns [] on a non-OK response — suggestions are best-effort', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));
    expect(await searchPlaces('somewhere')).toEqual([]);
  });

  it('collapses duplicated name/city parts within one hit', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ features: [{ properties: { name: 'Madison', city: 'Madison' } }] })
    );
    expect(await searchPlaces('madison')).toEqual(['Madison']);
  });
});

describe('mapsSearchUrl', () => {
  it('builds the keyless Maps search URL with the text encoded', () => {
    expect(mapsSearchUrl("Sam's place & grill")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Sam's%20place%20%26%20grill"
    );
  });
});
