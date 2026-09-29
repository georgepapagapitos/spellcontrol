import { describe, it, expect } from 'vitest';
import {
  CARD_COLOUR_SLUG,
  COMMANDER_COLOUR_SLUG,
  TOP_CARD_TYPES,
  TopListParseError,
  edhrecPathFor,
  listKeyString,
  normalizeColors,
  parseTopList,
  parseTopListQuery,
  sourceUrlFor,
  type TopListKey,
} from './top-lists';
// Cut from the real pages on 2026-09-29 (a few cardviews each, fields as sent).
import commandersWeek from './__fixtures__/commanders-week.json';
import topSalt from './__fixtures__/top-salt.json';
import topAzorius from './__fixtures__/top-azorius.json';
import topInstants from './__fixtures__/top-instants.json';
import topYear from './__fixtures__/top-year.json';
import redirect from './__fixtures__/redirect.json';

function key(q: Record<string, unknown>): TopListKey {
  const r = parseTopListQuery(q);
  if (!r.ok) throw new Error(`expected a valid key, got: ${r.error}`);
  return r.key;
}

function rejects(q: Record<string, unknown>): string {
  const r = parseTopListQuery(q);
  if (r.ok) throw new Error(`expected a 400 for ${JSON.stringify(q)}`);
  return r.error;
}

/** Every non-empty WUBRG subset, in WUBRG order. */
function allColourSubsets(): string[] {
  const out: string[] = [];
  for (let mask = 1; mask < 32; mask++) {
    out.push([...'WUBRG'].filter((_, i) => mask & (1 << i)).join(''));
  }
  return out;
}

describe('parseTopListQuery', () => {
  it('defaults the period to week', () => {
    expect(key({ kind: 'commanders' })).toEqual({
      kind: 'commanders',
      period: 'week',
      colors: null,
      type: null,
    });
    expect(key({ kind: 'cards' }).period).toBe('week');
  });

  it('keeps an explicit period when nothing filters the list', () => {
    for (const period of ['week', 'month', 'year']) {
      expect(key({ kind: 'cards', period }).period).toBe(period);
    }
  });

  it('answers a colour or type filter with the 2-year list', () => {
    expect(key({ kind: 'commanders', period: 'week', colors: 'wu' })).toEqual({
      kind: 'commanders',
      period: 'year',
      colors: 'WU',
      type: null,
    });
    expect(key({ kind: 'cards', period: 'month', type: 'lands' }).period).toBe('year');
    expect(key({ kind: 'cards', colors: 'g', type: 'creatures' })).toEqual({
      kind: 'cards',
      period: 'year',
      colors: 'G',
      type: 'creatures',
    });
  });

  it('treats an empty colour filter as none', () => {
    expect(key({ kind: 'cards', colors: '' })).toMatchObject({ colors: null, period: 'week' });
  });

  it('gives salt no period, colour or type', () => {
    expect(key({ kind: 'salt' })).toEqual({ kind: 'salt', period: null, colors: null, type: null });
    expect(key({ kind: 'salt', period: 'month' }).period).toBeNull();
  });

  it.each([
    [{}],
    [{ kind: 'lands' }],
    [{ kind: ['cards', 'salt'] }],
    [{ kind: 'cards', period: 'day' }],
    [{ kind: 'cards', period: ['week'] }],
    [{ kind: 'cards', colors: 'X' }],
    [{ kind: 'cards', colors: 'WW' }],
    [{ kind: 'cards', colors: 'CW' }],
    [{ kind: 'cards', colors: ['W'] }],
    [{ kind: 'cards', type: 'artifacts' }],
    [{ kind: 'cards', type: ['lands'] }],
    [{ kind: 'commanders', type: 'creatures' }],
    [{ kind: 'salt', colors: 'W' }],
    [{ kind: 'salt', type: 'lands' }],
  ])('rejects %j', (q) => {
    expect(rejects(q)).toMatch(/\.$/);
  });
});

describe('normalizeColors', () => {
  it('orders letters WUBRG whatever the input order and case', () => {
    expect(normalizeColors('gw')).toBe('WG');
    expect(normalizeColors('RBU')).toBe('UBR');
    expect(normalizeColors(' c ')).toBe('C');
  });
});

describe('edhrecPathFor', () => {
  it('maps every colour identity to a slug on both kinds', () => {
    const subsets = allColourSubsets();
    expect(subsets).toHaveLength(31);
    for (const colors of [...subsets, 'C']) {
      expect(COMMANDER_COLOUR_SLUG[colors], colors).toBeTruthy();
      expect(CARD_COLOUR_SLUG[colors], colors).toBeTruthy();
      expect(edhrecPathFor(key({ kind: 'commanders', colors }))).toBe(
        `/pages/commanders/${COMMANDER_COLOUR_SLUG[colors]}.json`
      );
      expect(edhrecPathFor(key({ kind: 'cards', colors }))).toBe(
        `/pages/top/${CARD_COLOUR_SLUG[colors]}.json`
      );
      // A type filter reads a list on the same colour page.
      expect(edhrecPathFor(key({ kind: 'cards', colors, type: 'lands' }))).toBe(
        `/pages/top/${CARD_COLOUR_SLUG[colors]}.json`
      );
    }
  });

  it('uses mono-<colour> for commanders and the bare colour for cards', () => {
    expect(edhrecPathFor(key({ kind: 'commanders', colors: 'W' }))).toBe(
      '/pages/commanders/mono-white.json'
    );
    expect(edhrecPathFor(key({ kind: 'cards', colors: 'W' }))).toBe('/pages/top/white.json');
    expect(edhrecPathFor(key({ kind: 'cards', colors: 'WUBRG' }))).toBe(
      '/pages/top/five-color.json'
    );
    expect(edhrecPathFor(key({ kind: 'commanders', colors: 'C' }))).toBe(
      '/pages/commanders/colorless.json'
    );
  });

  it('maps each period and each type page', () => {
    for (const period of ['week', 'month', 'year']) {
      expect(edhrecPathFor(key({ kind: 'commanders', period }))).toBe(
        `/pages/commanders/${period}.json`
      );
      expect(edhrecPathFor(key({ kind: 'cards', period }))).toBe(`/pages/top/${period}.json`);
    }
    for (const type of TOP_CARD_TYPES) {
      expect(edhrecPathFor(key({ kind: 'cards', type }))).toBe(`/pages/top/${type}.json`);
    }
    expect(edhrecPathFor(key({ kind: 'salt' }))).toBe('/pages/top/salt.json');
  });
});

describe('sourceUrlFor', () => {
  it('links the edhrec.com page for the same list', () => {
    expect(sourceUrlFor(key({ kind: 'commanders' }))).toBe('https://edhrec.com/commanders/week');
    expect(sourceUrlFor(key({ kind: 'cards', colors: 'W' }))).toBe('https://edhrec.com/top/white');
    expect(sourceUrlFor(key({ kind: 'cards', type: 'utility-lands' }))).toBe(
      'https://edhrec.com/top/utility-lands'
    );
    expect(sourceUrlFor(key({ kind: 'salt' }))).toBe('https://edhrec.com/top/salt');
  });
});

describe('listKeyString', () => {
  it('gives each distinct list its own key', () => {
    const keys = [
      key({ kind: 'commanders' }),
      key({ kind: 'commanders', period: 'month' }),
      key({ kind: 'commanders', colors: 'W' }),
      key({ kind: 'cards', colors: 'W' }),
      key({ kind: 'cards', colors: 'W', type: 'lands' }),
      key({ kind: 'cards', type: 'lands' }),
      key({ kind: 'salt' }),
    ].map(listKeyString);
    expect(new Set(keys).size).toBe(keys.length);
    expect(listKeyString(key({ kind: 'salt' }))).toBe('salt:-:-:-');
  });
});

describe('parseTopList', () => {
  it('drops partner pairs from a commander list and re-ranks', () => {
    const entries = parseTopList(commandersWeek, key({ kind: 'commanders' }));
    expect(entries.map((e) => e.name)).toEqual([
      'Jace, Multiverse Architect',
      "Y'shtola, Night's Blessed",
      'Tam, the Possibility',
      'Ms. Bumbleflower',
    ]);
    expect(entries.map((e) => e.rank)).toEqual([1, 2, 3, 4]);
    expect(entries[0]).toEqual({
      rank: 1,
      name: 'Jace, Multiverse Architect',
      scryfallId: '55cd03d9-2535-4cf3-a8b2-1418e1190f4a',
      numDecks: 3357,
      // EDHREC sends 0 on the commander lists: unknown, not zero.
      potentialDecks: null,
      salt: null,
    });
  });

  it('keeps split cards on a card list', () => {
    const entries = parseTopList(topInstants, key({ kind: 'cards', type: 'instants' }));
    expect(entries.map((e) => e.name)).toContain('Wear // Tear');
    expect(entries.at(-1)).toMatchObject({ rank: 4, potentialDecks: 2361965 });
  });

  it('reads deck counts and the potential-deck denominator off a period list', () => {
    const [solRing] = parseTopList(topYear, key({ kind: 'cards', period: 'year' }));
    expect(solRing.name).toBe('Sol Ring');
    expect(solRing.numDecks).toBeGreaterThan(0);
    expect(solRing.potentialDecks).toBeGreaterThan(solRing.numDecks);
  });

  it('reads the salt score', () => {
    const entries = parseTopList(topSalt, key({ kind: 'salt' }));
    expect(entries[0]).toMatchObject({ rank: 1, name: 'Stasis' });
    expect(entries[0].salt).toBeCloseTo(3.057, 2);
  });

  it("picks the colour page's top cards, or the requested type's list", () => {
    const top = parseTopList(topAzorius, key({ kind: 'cards', colors: 'WU' }));
    expect(top.map((e) => e.name)).toEqual([
      'Talisman of Progress',
      expect.any(String),
      expect.any(String),
    ]);
    const creatures = parseTopList(
      topAzorius,
      key({ kind: 'cards', colors: 'WU', type: 'creatures' })
    );
    expect(creatures).toHaveLength(2);
    expect(creatures[0].name).not.toBe(top[0].name);
  });

  it('answers an empty list when a colour page has no card of that type', () => {
    // The fixture, like the real Azorius page trimmed, has no battles list.
    expect(parseTopList(topAzorius, key({ kind: 'cards', colors: 'WU', type: 'battles' }))).toEqual(
      []
    );
  });

  it('falls back to inclusion and nulls an id that is not a Scryfall id', () => {
    const page = structuredClone(topYear);
    const cv = page.container.json_dict.cardlists[0].cardviews[0] as Record<string, unknown>;
    cv.inclusion = cv.num_decks;
    delete cv.num_decks;
    cv.id = 'not-a-uuid';
    const [entry] = parseTopList(page, key({ kind: 'cards', period: 'year' }));
    expect(entry.numDecks).toBe(cv.inclusion);
    expect(entry.scryfallId).toBeNull();
  });

  it('skips a cardview with no name', () => {
    const page = structuredClone(topYear);
    (page.container.json_dict.cardlists[0].cardviews[0] as Record<string, unknown>).name = '';
    const entries = parseTopList(page, key({ kind: 'cards', period: 'year' }));
    expect(entries[0]).toMatchObject({ rank: 1, name: 'Arcane Signet' });
  });

  it.each([
    ['a redirect', redirect],
    ['a non-object', 'Access Denied'],
    ['no card lists', { container: { json_dict: {} } }],
    ['an empty card-list array', { container: { json_dict: { cardlists: [] } } }],
  ])('throws on %s', (_label, body) => {
    expect(() => parseTopList(body, key({ kind: 'commanders' }))).toThrow(TopListParseError);
  });

  it('throws when a colour page has no top cards at all', () => {
    const page = structuredClone(topAzorius);
    page.container.json_dict.cardlists = page.container.json_dict.cardlists.filter(
      (l) => l.tag !== 'topcards'
    );
    expect(() => parseTopList(page, key({ kind: 'cards', colors: 'WU' }))).toThrow(
      TopListParseError
    );
  });
});
