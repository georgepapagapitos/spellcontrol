// EDHREC + Scryfall SCHEMA CANARY (E508). Live, opt-in, never part of `npm test`.
//
// On 2026-07-12 EDHREC renamed fields (`inclusion` -> `num_decks`, the deck
// count moved under container.json_dict.card) and every generation silently
// fell back to the no-EDHREC path in production (#1145): the parsers default
// a missing field to 0 or [], so nothing threw. This canary fetches one of
// each source the generator depends on, through the app's REAL clients and
// parsers, and fails naming the field that came back empty:
//
//   EDHREC commander page, commander x theme page, card page (lift)
//   Scryfall /cards/named and /cards/collection
//
// Run (the same production-mode requirement as deckGenerator.live.test.ts:
// BASE_URL is a relative dev-proxy path unless import.meta.env.DEV is false):
//
//   cd frontend && NODE_ENV=production LIVE_GEN=1 ./node_modules/.bin/vitest run \
//     --mode production src/deck-builder/services/deckBuilder/sourceSchema.live.test.ts
//
// Gated on LIVE_GEN rather than a flag of its own: src/test/setup.ts swaps
// fetch for a network guard unless LIVE_GEN is set, and a canary behind that
// guard would report drift for every source. It never reads
// LIVE_GEN_HTTP_CACHE: a replayed response would hide the drift it exists to
// catch.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EDHRECCard, EDHRECCommanderData, ScryfallCard } from '@/deck-builder/types';
import {
  fetchCardLiftPool,
  fetchCommanderData,
  fetchCommanderThemeData,
  formatCommanderNameForUrl,
} from '@/deck-builder/services/edhrec/client';
import { getCardByName, getCardsByNames } from '@/deck-builder/services/scryfall/client';

const COMMANDER = 'Krenko, Mob Boss';
const THEME_SLUG = 'goblins'; // 6213 decks when E228 measured it (2026-08-07)
const LIFT_SEED = 'Sol Ring';
const NAMED = 'Counterspell';
// A plain card, a staple, and an MDFC asked for by its FRONT face: the
// collection answer must carry per-face oracle text for the last one.
const COLLECTION = ['Swords to Plowshares', 'Brainstorm', 'Sink into Stupor'];

const EDHREC = 'https://json.edhrec.com';
const requests: string[] = [];
let realFetch: typeof fetch;

/** Whether a recorded request hit Scryfall's API at `path`, matched on the
 *  parsed hostname and path rather than a substring of the URL. */
function reachedScryfall(method: string, path: string): boolean {
  return requests.some((r) => {
    const [m, url] = r.split(' ', 2);
    if (m !== method || !URL.canParse(url)) return false;
    const parsed = new URL(url);
    return parsed.hostname === 'api.scryfall.com' && parsed.pathname === path;
  });
}

beforeAll(() => {
  realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    requests.push(`${init?.method ?? 'GET'} ${url}`);
    const headers = {
      ...(init?.headers as Record<string, string> | undefined),
      'User-Agent': 'SpellControl-SchemaCanary/1.0',
    };
    return realFetch(input, { ...init, headers });
  });
});

afterAll(() => vi.unstubAllGlobals());

/**
 * The raw payload's shape, fetched only when a check has already failed, so
 * the failure says what EDHREC is sending now instead of just "0".
 */
async function rawShape(url: string): Promise<string> {
  try {
    const res = await realFetch(url, {
      headers: { 'User-Agent': 'SpellControl-SchemaCanary/1.0' },
    });
    if (!res.ok) return `raw ${url}: HTTP ${res.status}`;
    const raw = (await res.json()) as Record<string, unknown>;
    const dict = (raw.container as { json_dict?: Record<string, unknown> } | undefined)?.json_dict;
    const lists =
      (dict?.cardlists as Array<{ tag?: string; cardviews?: object[] }> | undefined) ?? [];
    const firstView = lists.find((l) => l.cardviews?.length)?.cardviews?.[0];
    return [
      `raw ${url}:`,
      `  top-level keys: ${Object.keys(raw).sort().join(', ')}`,
      `  container.json_dict keys: ${dict ? Object.keys(dict).sort().join(', ') : '(missing)'}`,
      `  cardlist tags: ${lists.map((l) => l.tag).join(', ') || '(none)'}`,
      `  first cardview keys: ${firstView ? Object.keys(firstView).sort().join(', ') : '(none)'}`,
    ].join('\n');
  } catch (err) {
    return `raw ${url}: ${String(err)}`;
  }
}

/**
 * Collects every missing field on one payload, then fails once naming all of
 * them plus the raw shape, so one run shows the whole drift instead of the
 * first symptom.
 */
function driftCheck(rawUrl: string) {
  const problems: string[] = [];
  return {
    need(ok: boolean, what: string) {
      if (!ok) problems.push(what);
    },
    async done() {
      if (problems.length === 0) return;
      throw new Error(`SCHEMA DRIFT:\n- ${problems.join('\n- ')}\n${await rawShape(rawUrl)}`);
    },
  };
}

function checkCommanderPage(
  data: EDHRECCommanderData,
  label: string,
  drift: ReturnType<typeof driftCheck>
) {
  drift.need(
    data.stats.numDecks > 0,
    `${label}: stats.numDecks is ${data.stats.numDecks}. Parsed from num_decks_avg, else container.json_dict.card.num_decks; zero sends every generation down the no-EDHREC path.`
  );
  drift.need(
    data.cardlists.allNonLand.length > 0,
    `${label}: no nonland cards parsed from container.json_dict.cardlists[].cardviews`
  );
  for (const list of ['creatures', 'instants', 'lands'] as const) {
    drift.need(
      data.cardlists[list].length > 0,
      `${label}: cardlists.${list} is empty; its cardlist tag is gone or renamed`
    );
  }
  const cards: EDHRECCard[] = data.cardlists.allNonLand;
  const withInclusion = cards.filter((c) => c.inclusion > 0).length;
  drift.need(
    withInclusion >= cards.length * 0.9,
    `${label}: inclusion is 0 on ${cards.length - withInclusion} of ${cards.length} cards. Parsed from cardviews[].inclusion or num_decks over potential_decks.`
  );
  const withSynergy = cards.filter((c) => typeof c.synergy === 'number').length;
  drift.need(
    withSynergy >= cards.length * 0.9,
    `${label}: synergy missing on ${cards.length - withSynergy} of ${cards.length} cards (cardviews[].synergy)`
  );
}

describe.skipIf(!process.env.LIVE_GEN)('source schema canary', () => {
  it('EDHREC commander page parses into a usable pool', async () => {
    const slug = formatCommanderNameForUrl(COMMANDER);
    const drift = driftCheck(`${EDHREC}/pages/commanders/${slug}.json`);
    const data = await fetchCommanderData(COMMANDER);
    const label = `commander page ${slug}`;
    checkCommanderPage(data, label, drift);
    // The app pre-fills the land sliders from these, and the generator's
    // curve targets read the curve.
    drift.need(
      data.stats.landDistribution.total > 0,
      `${label}: stats.landDistribution.total is 0 (raw top-level "land")`
    );
    drift.need(
      Object.keys(data.stats.manaCurve).length > 0,
      `${label}: stats.manaCurve is empty (raw panels.mana_curve)`
    );
    drift.need(data.themes.length > 0, `${label}: no themes parsed (raw panels.taglinks)`);
    await drift.done();
  }, 60_000);

  it('EDHREC commander x theme page parses into a usable pool', async () => {
    const slug = formatCommanderNameForUrl(COMMANDER);
    const drift = driftCheck(`${EDHREC}/pages/commanders/${slug}/${THEME_SLUG}.json`);
    const data = await fetchCommanderThemeData(COMMANDER, THEME_SLUG);
    checkCommanderPage(data, `theme page ${slug}/${THEME_SLUG}`, drift);
    await drift.done();
  }, 60_000);

  it('EDHREC card page yields lift entries', async () => {
    const slug = formatCommanderNameForUrl(LIFT_SEED);
    const drift = driftCheck(`${EDHREC}/pages/cards/${slug}.json`);
    // fetchCardLiftPool soft-fails to [] on any error, so an empty pool is
    // either a failed fetch or drift; the raw shape tells which.
    const pool = await fetchCardLiftPool(LIFT_SEED);
    drift.need(
      pool.length > 0,
      `card page ${slug}: no lift entries parsed (cardviews[].lift, num_decks, potential_decks)`
    );
    drift.need(
      pool.every((e) => e.lift > 0 && e.potentialDecks > 0 && e.numDecks > 0),
      `card page ${slug}: lift entries without lift/potential_decks/num_decks`
    );
    await drift.done();
  }, 60_000);

  it('Scryfall /cards/named answers with the fields the generator reads', async () => {
    const card = await getCardByName(NAMED);
    expect(
      reachedScryfall('GET', '/cards/named'),
      'the named lookup never reached api.scryfall.com/cards/named'
    ).toBe(true);
    expectScryfallCard(card, NAMED);
  }, 60_000);

  it('Scryfall /cards/collection answers every name with oracle text, per face for an MDFC', async () => {
    const found = await getCardsByNames(COLLECTION);
    expect(
      reachedScryfall('POST', '/cards/collection'),
      'the batch lookup never reached POST api.scryfall.com/cards/collection'
    ).toBe(true);
    for (const name of COLLECTION) {
      const card =
        found.get(name) ?? [...found.values()].find((c) => c.name.split(' // ')[0] === name);
      expect(card, `/cards/collection returned nothing for "${name}"`).toBeDefined();
      expectScryfallCard(card!, name);
    }
  }, 60_000);
});

function expectScryfallCard(card: ScryfallCard, asked: string): void {
  const oracle =
    card.oracle_text ||
    (card.card_faces ?? [])
      .map((f) => f.oracle_text ?? '')
      .filter(Boolean)
      .join(' // ');
  expect(oracle, `${asked}: oracle_text (or card_faces[].oracle_text) is empty`).toBeTruthy();
  if (card.card_faces && card.card_faces.length >= 2) {
    for (const [i, face] of card.card_faces.entries()) {
      expect(face.oracle_text, `${asked}: card_faces[${i}].oracle_text is missing`).toBeTypeOf(
        'string'
      );
      expect(face.type_line, `${asked}: card_faces[${i}].type_line is missing`).toBeTruthy();
    }
  }
  expect(card.type_line, `${asked}: type_line is missing`).toBeTruthy();
  expect(Array.isArray(card.color_identity), `${asked}: color_identity is not an array`).toBe(true);
  expect(typeof card.cmc, `${asked}: cmc is not a number`).toBe('number');
  expect(card.rarity, `${asked}: rarity is missing`).toBeTruthy();
  expect(card.legalities?.commander, `${asked}: legalities.commander is missing`).toBeTruthy();
  expect(
    card.legalities?.paupercommander,
    `${asked}: legalities.paupercommander is missing`
  ).toBeTruthy();
  expect(card.legalities?.brawl, `${asked}: legalities.brawl is missing`).toBeTruthy();
  expect(Array.isArray(card.games), `${asked}: games is not an array`).toBe(true);
  expect(
    !!(card.prices?.usd || card.prices?.eur),
    `${asked}: prices.usd and prices.eur are both empty`
  ).toBe(true);
}
