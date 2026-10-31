// E1057: deck generation with no EDHREC data at all (the site down, blocking
// us, or a commander it has no page for) must still build a legal, reasonable
// 99 from Scryfall + the tagger snapshot, and say so.
//
// What this runs: the REAL generateDeck, the REAL EDHREC client and request
// layer (every EDHREC request fails at the fetch boundary, as a network error,
// a 503 with no cache header, or the 403 EDHREC gives a page it doesn't have),
// the real tagger snapshot, and Scryfall answers RECORDED from the live API
// for three real commanders (Krenko, Tatyova, Atraxa) across one, two and four
// colors. Only the Scryfall client's async lookups are replayed; everything
// else is the shipping code.
//
// Refreshing the recording (needs the network; Scryfall rate-limits, so it
// takes a few minutes):
//   cd frontend && NODE_ENV=production LIVE_GEN=1 NO_EDHREC_RECORD=1 ./node_modules/.bin/vitest run \
//     --mode production src/deck-builder/services/deckBuilder/deckGenerator.noEdhrec.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GeneratedDeck, ScryfallCard } from '@/deck-builder/types';

const here = dirname(fileURLToPath(import.meta.url));

vi.mock('@/deck-builder/services/scryfall/client', async (orig) => {
  const { wrapScryfallClient } = await import('./__fixtures__/no-edhrec-replay');
  return wrapScryfallClient(await orig<typeof import('@/deck-builder/services/scryfall/client')>());
});

import { generateDeck, clearGenerationCache } from './deckGenerator';
import { resetEdhrecProxyState } from '@/deck-builder/services/edhrec/request';
import { checkDeckInvariants, formatViolations, hardViolations } from './deckInvariants';
import { card, commanderCard } from './__fixtures__/invariant-deck';
import { customization } from './__fixtures__/settings-universe';
import { hasNoEdhrecPool } from './deckGeneration/noEdhrecPool';
import { RECORD, saveFixture, setActiveRun } from './__fixtures__/no-edhrec-replay';

// ---- EDHREC down, at the fetch boundary ------------------------------------

type Outage = 'network' | '503' | '403';
let outage: Outage = 'network';
const edhrecUrls: string[] = [];

const taggerSnapshot = readFileSync(
  resolve(here, '__fixtures__', 'tagger-tags.fixture.json'),
  'utf8'
);

function stubFetch(realFetch: typeof fetch) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('tagger-tags')) return new Response(taggerSnapshot, { status: 200 });
    if (/json\.edhrec\.com|\/edhrec-api\/|\/api\/edhrec\//.test(url)) {
      edhrecUrls.push(url);
      if (outage === 'network') throw new TypeError('fetch failed');
      if (outage === '503') {
        // Retry-After keeps the client's real backoff from sleeping seconds.
        return new Response('unavailable', { status: 503, headers: { 'Retry-After': '0.001' } });
      }
      return new Response('forbidden', { status: 403 });
    }
    if (RECORD && URL.canParse(url) && new URL(url).hostname === 'api.scryfall.com') {
      return realFetch(input, {
        ...init,
        headers: {
          ...(init?.headers as Record<string, string>),
          'User-Agent': 'SpellControl-Test/1.0',
        },
      });
    }
    // Everything else (card-similar snapshot, the combo-tag lookup) is unavailable.
    return new Response('{}', { status: 404 });
  });
}

let realFetch: typeof fetch;
beforeAll(() => {
  realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', stubFetch(realFetch));
});
afterAll(() => {
  vi.unstubAllGlobals();
  saveFixture();
});
beforeEach(() => {
  clearGenerationCache();
  resetEdhrecProxyState();
  edhrecUrls.length = 0;
  outage = 'network';
});
afterEach(() => vi.useRealTimers());

// ---- The three commanders ----------------------------------------------------

const PANEL = [
  { name: 'Krenko, Mob Boss', identity: ['R'], colors: 1 },
  { name: 'Tatyova, Benthic Druid', identity: ['G', 'U'], colors: 2 },
  { name: "Atraxa, Praetors' Voice", identity: ['G', 'W', 'U', 'B'], colors: 4 },
] as const;

function cardFor(name: string): ScryfallCard {
  try {
    return commanderCard(name);
  } catch {
    return card(name);
  }
}

async function build(row: (typeof PANEL)[number]): Promise<{ deck: GeneratedDeck; ctx: object }> {
  setActiveRun(row.name);
  const ctx = {
    commander: cardFor(row.name),
    partnerCommander: null,
    colorIdentity: [...row.identity],
    customization: customization({ wholeDeckSearch: false }),
    selectedThemes: [],
  };
  return { deck: await generateDeck(ctx), ctx };
}

const nonLandCount = (deck: GeneratedDeck) =>
  Object.entries(deck.categories).reduce(
    (n, [cat, cards]) => n + (cat === 'lands' ? 0 : cards.length),
    0
  );

describe('generateDeck with no EDHREC data', () => {
  for (const row of PANEL) {
    it(`builds a legal, graded ${row.colors}-color deck for ${row.name} when EDHREC is unreachable`, async () => {
      const { deck, ctx } = await build(row);

      // Legal: 99 cards, singleton, inside the commander's colors, land count in range.
      const violations = checkDeckInvariants(
        deck,
        ctx as Parameters<typeof checkDeckInvariants>[1]
      );
      expect(formatViolations(hardViolations(violations))).toBe('');
      const lands = deck.categories.lands.length;
      // The 37 asked for. With no EDHREC land stats there is nothing to auto-tune from.
      expect(lands).toBe(37);
      // No HARD and no SOFT finding of any kind (lands on the asked count, roles inside their caps).
      expect(formatViolations(violations)).toBe('');
      expect(lands + nonLandCount(deck)).toBe(99);

      // Reasonable: the pipeline ran on a function-built pool, so the deck has
      // role targets, a grade, and the roles that hold a deck together.
      expect(deck.roleTargets).toBeDefined();
      expect(deck.deckGrade).toBeDefined();
      const roles = deck.roleCounts ?? {};
      expect(roles.ramp ?? 0).toBeGreaterThanOrEqual(
        Math.floor((deck.roleTargets?.ramp ?? 0) * 0.8)
      );
      expect(roles.removal ?? 0).toBeGreaterThanOrEqual(
        Math.floor((deck.roleTargets?.removal ?? 0) * 0.8)
      );
      expect(roles.cardDraw ?? 0).toBeGreaterThanOrEqual(
        Math.floor((deck.roleTargets?.cardDraw ?? 0) * 0.8)
      );

      // Disclosed: tagged as built without EDHREC, with the sentence the Build Report shows.
      expect(deck.dataSource).toBe('scryfall');
      expect(deck.integrityNotes).toContain(
        `Couldn't load EDHREC data for ${row.name}. Built from card function and overall Commander play instead.`
      );
      expect(edhrecUrls.length).toBeGreaterThan(0);
    }, 120_000);
  }

  for (const kind of ['503', '403'] as const) {
    it(`builds the same way when EDHREC answers ${kind}`, async () => {
      outage = kind;
      const { deck, ctx } = await build(PANEL[0]);
      expect(
        formatViolations(
          hardViolations(
            checkDeckInvariants(deck, ctx as Parameters<typeof checkDeckInvariants>[1])
          )
        )
      ).toBe('');
      expect(deck.dataSource).toBe('scryfall');
      expect(deck.roleTargets).toBeDefined();
      expect(deck.integrityNotes?.some((n) => n.startsWith("Couldn't load EDHREC data"))).toBe(
        true
      );
    }, 120_000);
  }

  it('does not remember the stand-in pool: a regeneration asks EDHREC again', async () => {
    await build(PANEL[0]);
    const firstRun = edhrecUrls.length;
    await build(PANEL[0]);
    expect(edhrecUrls.length).toBeGreaterThan(firstRun);
  }, 120_000);

  it('tells apart a missing pool from a thin one', () => {
    const page = (numDecks: number, cards: number) =>
      ({
        stats: { numDecks },
        cardlists: { allNonLand: Array.from({ length: cards }, () => ({})) },
      }) as unknown as Parameters<typeof hasNoEdhrecPool>[0];
    expect(hasNoEdhrecPool(null)).toBe(true);
    expect(hasNoEdhrecPool(page(0, 0))).toBe(true);
    expect(hasNoEdhrecPool(page(12, 40))).toBe(false); // thin, but real: the E93 ladder owns it
    expect(hasNoEdhrecPool(page(0, 5))).toBe(false);
  });
});
