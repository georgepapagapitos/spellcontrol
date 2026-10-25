// OFFLINE harness: runs the assembly clock over the bracket calibration corpus
// and writes the frozen result the calibration benchmark reads
// (packages/deck-metrics/calibration/fixtures/clock-signals.json).
//
//   CLOCK_SIGNALS=1 CLOCK_CARDS=<cards.json> ./node_modules/.bin/vitest run src/lib/mana-sim/clock-signals.live.test.ts
//
// <cards.json> is { [card name]: ScryfallCard } for every name in the corpus
// (exported from the backend's scryfall-cache.db). Nothing here touches the
// network: the win path comes from the production detector over the corpus
// decks, the clock from the production engine.
//
// Combos: the corpus carries each complete Spellbook combo's pieces and bracket
// tag but not its result labels, so a combo that counts toward a floor (tag not
// Exhibition/Core) is read as "Win the game", and an Exhibition/Core one as a
// loop that needs a payoff. That is the same call the estimator makes.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScryfallCard } from '@/deck-builder/types';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..', '..');
const ENABLED = process.env.CLOCK_SIGNALS === '1' && !!process.env.CLOCK_CARDS;
const OUT = resolve(root, 'packages/deck-metrics/calibration/fixtures/clock-signals.json');
const TURNS = 12;

describe.skipIf(!ENABLED)('clock signals over the calibration corpus', () => {
  beforeAll(() => {
    const tagger = JSON.parse(
      readFileSync(resolve(root, 'frontend/public/tagger-tags.json'), 'utf8')
    );
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => tagger }));
  });

  it('writes clock-signals.json', async () => {
    const corpus = JSON.parse(
      readFileSync(resolve(root, 'packages/deck-metrics/calibration/fixtures/corpus.json'), 'utf8')
    ) as {
      decks: Array<{
        id: string;
        commanders: string[];
        cards: Record<string, number>;
        combos: string[];
      }>;
      combos: Record<string, [string | null, number, string[]]>;
    };
    const byName = JSON.parse(readFileSync(process.env.CLOCK_CARDS!, 'utf8')) as Record<
      string,
      ScryfallCard
    >;
    const { loadTaggerData } = await import('@/deck-builder/services/tagger/client');
    await loadTaggerData();
    const { analyzeDeckSynergy } = await import('@/deck-builder/services/synergy/deckSynergy');
    const { detectWinConditions } = await import('@/deck-builder/services/winConditions/detect');
    const { toClockLibrary } = await import('./hand-classify');
    const { simulateAssemblyClock } = await import('./clock');
    const { speedPathOf } = await import('./speed-path');

    const out: Record<string, unknown> = {};
    for (const deck of corpus.decks) {
      const cards: ScryfallCard[] = [];
      for (const [name, n] of Object.entries(deck.cards)) {
        const c = byName[name];
        if (c) for (let i = 0; i < n; i++) cards.push(c);
      }
      const commander = byName[deck.commanders[0]] ?? null;
      const partner = deck.commanders[1] ? (byName[deck.commanders[1]] ?? null) : null;
      const combosInDeck = deck.combos.map((id) => {
        const [tag, , pieces] = corpus.combos[id];
        const loop = tag === 'E' || tag === 'C';
        return { cards: pieces, results: loop ? ['Infinite mana'] : ['Win the game'] };
      });
      const wc = detectWinConditions({
        cards,
        commander,
        partnerCommander: partner,
        combosInDeck,
        deckSynergy: analyzeDeckSynergy(cards),
        format: 'commander',
      });
      const path = speedPathOf(wc);
      if (!path) {
        out[deck.id] = { category: wc.primary?.category ?? null, clock: null };
        continue;
      }
      const clock = simulateAssemblyClock(toClockLibrary(cards), path.assembly, {
        iterations: 1000,
        wildcards: [...path.tutors],
      });
      out[deck.id] = {
        category: wc.primary!.category,
        clock: clock
          ? {
              runs: clock.runs,
              median: clock.typicalTurn,
              assembledBy: clock.assembledBy
                .slice(0, TURNS + 1)
                .map((p) => Math.round(p * 1000) / 1000),
            }
          : null,
      };
    }
    writeFileSync(OUT, JSON.stringify(out));
    expect(Object.keys(out).length).toBe(corpus.decks.length);
  }, 1_800_000);
});
