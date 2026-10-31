// @vitest-environment node
//
// E1058, on Talrand, Sky Summoner's real page, combos and cards (the seed and
// candidates the whole-deck search got in the E1052 V1 panel, 2026-10-31). The
// search seated Narset's Reversal + Isochron Scepter (a two-card combo) in the
// two slots Fierce Guardianship and Mana Drain took otherwise, and the deck
// lost both counters. A combo seating the premium singles over its slots
// outscore is not taken.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DetectedCombo, LiftEntry, Pacing, ScryfallCard } from '@/deck-builder/types';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import { countedRoleOf } from '../commanderDeckAnalysis';
import { createObjectiveContext, type EdhrecRow } from './index';
import { optimizeDeck } from './optimizer';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) =>
  JSON.parse(readFileSync(resolve(here, '__fixtures__', name), 'utf8'));
const FIX = read('talrand.fixture.json') as {
  commanders: ScryfallCard[];
  seed: ScryfallCard[];
  candidates: ScryfallCard[];
  colorIdentity: string[];
  customization: Record<string, unknown>;
  rows: Array<[string, EdhrecRow]>;
  roleTargets: Record<string, number>;
  pacing: Pacing;
  combos: DetectedCombo[];
  lift: Array<[string, LiftEntry[]]>;
  globalRank: Array<[string, number]>;
  gameChangerNames: string[];
  roleCeilings: Record<string, number>;
};

// The shipped tagger snapshot cut to the names in the fixture.
beforeAll(async () => {
  const tags = read('talrand-tagger-tags.fixture.json');
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => tags }));
  if (!(await loadTaggerData())) throw new Error('tagger data failed to load');
});
afterAll(() => vi.unstubAllGlobals());

const search = (without: string[] = []) => {
  const ctx = createObjectiveContext({
    colorIdentity: FIX.colorIdentity,
    customization: FIX.customization,
    edhrec: new Map(FIX.rows),
    roleTargets: FIX.roleTargets,
    roleOf: countedRoleOf,
    pacing: FIX.pacing,
    combos: FIX.combos,
    liftPools: new Map(FIX.lift),
    globalRank: new Map(FIX.globalRank),
    gameChangerNames: new Set(FIX.gameChangerNames),
  });
  return optimizeDeck(
    { commanders: FIX.commanders, cards: FIX.seed },
    FIX.candidates.filter((c) => !without.includes(c.name)),
    ctx,
    { trust: { roleCeilings: FIX.roleCeilings } }
  );
};

describe(
  'a combo seating against the premium answers it would pre-empt',
  { timeout: 60_000 },
  () => {
    it('leaves Fierce Guardianship and Mana Drain their slots', () => {
      const ins = search().swaps.flatMap((s) => s.in);
      expect(ins).toContain('Fierce Guardianship');
      expect(ins).toContain('Mana Drain');
      expect(ins).not.toContain("Narset's Reversal");
      expect(ins).not.toContain('Isochron Scepter');
    });

    it('still seats the combo when no premium answer is there to take the slots', () => {
      const swaps = search(['Fierce Guardianship', 'Mana Drain']).swaps;
      expect(swaps.find((s) => s.kind === 'combo')?.in).toEqual([
        "Narset's Reversal",
        'Isochron Scepter',
      ]);
    });
  }
);
