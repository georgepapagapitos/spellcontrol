import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCardLiftPool, fetchCardPlayedIn, parseCardPlayedIn } from './client';
// A real card page, cut from json.edhrec.com (see its `_source`).
import theOneRing from './__fixtures__/card-page-the-one-ring.fixture.json';

describe('parseCardPlayedIn', () => {
  const parsed = parseCardPlayedIn(theOneRing, 'the-one-ring');

  it("keeps EDHREC's own order for the top and new commander lists", () => {
    const top = theOneRing.container.json_dict.cardlists
      .find((l) => l.tag === 'topcommanders')!
      .cardviews.filter((cv) => !cv.name.includes(' // '))
      .map((cv) => cv.name);
    expect(parsed.top.map((p) => p.name)).toEqual(top);
    expect(parsed.new.map((p) => p.name)).toEqual([
      'Smaug the Impenetrable',
      'Whtz, the Bibliophile',
      'Smaug the Magnificent',
      "Thorin, King of Durin's Folk",
      'Thranduil, the Elvenking',
    ]);
  });

  it('drops partner pairs, which have no single card to show', () => {
    expect(parsed.top).toHaveLength(22); // 24 on the page, 2 of them pairs
    expect(parsed.top.some((p) => p.name.includes('//'))).toBe(false);
  });

  it("derives each commander's share of its own decks", () => {
    const smaug = parsed.new[0];
    expect(smaug).toMatchObject({ numDecks: 1993, potentialDecks: 6301 });
    expect(smaug.pct).toBeCloseTo(31.63, 1);
  });

  it("reads the card's own play rate across every deck that could run it", () => {
    expect(parsed.card).toEqual({
      numDecks: 800016,
      potentialDecks: 10153350,
      pct: (800016 / 10153350) * 100,
    });
    expect(parsed.slug).toBe('the-one-ring');
  });

  it('ignores the other card-page lists', () => {
    const names = [...parsed.top, ...parsed.new].map((p) => p.name);
    for (const cv of theOneRing.container.json_dict.cardlists.find(
      (l) => l.tag === 'highliftcards'
    )!.cardviews) {
      expect(names).not.toContain(cv.name);
    }
  });

  it('tolerates a malformed page', () => {
    expect(parseCardPlayedIn({}, 'x')).toEqual({
      status: 'ok',
      slug: 'x',
      card: null,
      top: [],
      new: [],
    });
  });
});

describe('fetchCardPlayedIn', () => {
  const fetchMock = vi.fn();
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses a page that exists', async () => {
    fetchMock.mockResolvedValue(json(theOneRing));
    const r = await fetchCardPlayedIn('The One Ring');
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/pages\/cards\/the-one-ring\.json$/);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.top).toHaveLength(22);
  });

  it('reads a 403 (no page on EDHREC) as none, and does not ask again', async () => {
    fetchMock.mockResolvedValue(new Response('AccessDenied', { status: 403 }));
    expect(await fetchCardPlayedIn('Brand New Card')).toEqual({ status: 'none' });
    expect(await fetchCardPlayedIn('Brand New Card')).toEqual({ status: 'none' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads any other failure as an error, and asks again next time', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    expect(await fetchCardPlayedIn('Flaky Card')).toEqual({ status: 'error' });
    fetchMock.mockResolvedValueOnce(json(theOneRing));
    expect((await fetchCardPlayedIn('Flaky Card')).status).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("follows a split card's redirect to its real page", async () => {
    // Live: /pages/cards/fire.json answers { redirect: "/cards/fire-ice" }.
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/pages/cards/fire.json')
        ? json({ redirect: '/cards/fire-ice' })
        : json(theOneRing)
    );
    const r = await fetchCardPlayedIn('Fire // Ice');
    expect(fetchMock.mock.calls.map((c) => String(c[0]).replace(/^.*\/pages/, ''))).toEqual([
      '/cards/fire.json',
      '/cards/fire-ice.json',
    ]);
    expect(r.status === 'ok' && r.slug).toBe('fire-ice');
  });

  it('reads offline as none without a request', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(await fetchCardPlayedIn('Offline Card')).toEqual({ status: 'none' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves the deck-generation reader soft-failing as before', async () => {
    fetchMock.mockResolvedValue(new Response('AccessDenied', { status: 403 }));
    expect(await fetchCardLiftPool('No Page Card')).toEqual([]);
    fetchMock.mockResolvedValue(json({ redirect: '/cards/somewhere-else' }));
    expect(await fetchCardLiftPool('Redirecting Card')).toEqual([]);
  });
});
