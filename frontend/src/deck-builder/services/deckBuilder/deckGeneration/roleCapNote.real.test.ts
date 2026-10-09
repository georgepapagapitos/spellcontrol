// @vitest-environment node
//
// E499: the overflow note counts what shipped. Real Meren of Clan Nel Toth
// decks (objective.fixture.json: Scryfall records, her EDHREC page, her combos)
// are the input; the expectation is the report's own recount (computeRoleCounts)
// against the picker's cap (roleCapLimit), not a hand-typed number.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import { computeRoleCounts } from '../commanderDeckAnalysis';
import { roleCapLimit } from '../roleCapAllowance';
import { frontFaceName } from '@/lib/cards/card-text';
import { BASELINE, FIX, TREATMENT } from '../deckObjective/__fixtures__/objectiveFixture';
import { buildFinalRoleCapOverflowNote } from './roleCapNote';

// The committed tagger snapshot (public/tagger-tags.json), the one the app ships.
beforeAll(async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const data = JSON.parse(
    readFileSync(resolve(here, '../../../../../public/tagger-tags.json'), 'utf8')
  );
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => data }));
  if (!(await loadTaggerData())) throw new Error('tagger data failed to load');
});
afterAll(() => vi.unstubAllGlobals());

const targets = FIX.meren.roleTargets as Record<string, number>;
const comboNames = new Set(
  FIX.meren.combos.flatMap((c) => c.cards.map((n) => frontFaceName(n).toLowerCase()))
);
const inclusionOf = (name: string) => FIX.merenPage[name]?.inclusion ?? 0;

function excessOver(cards: readonly ScryfallCard[]) {
  const counts = computeRoleCounts([...cards]).roleCounts;
  return Object.entries(targets).reduce(
    (s, [role, want]) => s + Math.max(0, (counts[role] ?? 0) - roleCapLimit(want)),
    0
  );
}

describe('buildFinalRoleCapOverflowNote on real Meren decks', () => {
  for (const [label, deck] of [
    ['baseline', BASELINE],
    ['treatment', TREATMENT],
  ] as const) {
    it(`${label}: the total is the real excess over the cap`, () => {
      const excess = excessOver(deck.cards);
      const note = buildFinalRoleCapOverflowNote(targets, deck.cards, inclusionOf, comboNames);
      expect(Object.values(computeRoleCounts([...deck.cards]).roleCounts).some((n) => n > 0)).toBe(
        true
      );
      if (excess === 0) expect(note).toBeUndefined();
      else expect(note).toMatch(new RegExp(`^${excess} cards? went past a role cap[.]`));
    });
  }

  it('says nothing when every role is inside its cap', () => {
    const roomy = Object.fromEntries(Object.keys(targets).map((r) => [r, 99]));
    expect(
      buildFinalRoleCapOverflowNote(roomy, BASELINE.cards, inclusionOf, comboNames)
    ).toBeUndefined();
  });

  it('counts every card past the cap, however it got in (a tight cap, no combos)', () => {
    const tight = Object.fromEntries(Object.keys(targets).map((r) => [r, 0]));
    const note = buildFinalRoleCapOverflowNote(tight, BASELINE.cards, () => 0, new Set());
    const counts = computeRoleCounts([...BASELINE.cards]).roleCounts;
    const expected = Object.keys(tight).reduce(
      (s, r) => s + Math.max(0, (counts[r] ?? 0) - roleCapLimit(0)),
      0
    );
    expect(note).toMatch(new RegExp(`^${expected} cards went past a role cap[.]`));
    expect(note).not.toMatch(/Overbuilt roles/);
  });
});
