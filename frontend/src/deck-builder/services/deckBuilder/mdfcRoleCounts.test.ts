// @vitest-environment node
//
// Guard (E573): a spell // land MDFC counts for the spell it is, wherever the
// generator seated it. Generation seats these in its land slots as often as in
// its spell slots (Fell the Profane // Fell Mire sat in the lands bucket in 6 of
// the 15 decks that ran it), and its shipped role count skipped the lands bucket:
// Lathril read removal 10 in the generation report and 11 on the deck page and
// in the analysis. Real cards (Scryfall 2026-09-29) and the real tagger rows.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { isMdfcLand } from '@/deck-builder/services/scryfall/client';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import fixture from './__fixtures__/mdfc-lands.fixture.json';
import { assemble, checks, cleanCategories, context } from './__fixtures__/invariant-deck';
import { checkDeckInvariants } from './deckInvariants';
import { computeRoleCounts, countedRoleOf } from './commanderDeckAnalysis';

beforeAll(async () => {
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({ generatedAt: 'pinned', tags: fixture.tags }),
  }));
  if (!(await loadTaggerData())) throw new Error('tagger data failed to load');
});
afterAll(() => vi.unstubAllGlobals());

const mdfc = (name: string): ScryfallCard =>
  structuredClone(fixture.cards[name as keyof typeof fixture.cards]) as unknown as ScryfallCard;
const FELL = 'Fell the Profane // Fell Mire';
const SPIKEFIELD = 'Spikefield Hazard // Spikefield Cave';
const SILUNDI = 'Silundi Vision // Silundi Isle';

describe('a spell // land MDFC in the role counts', () => {
  it('is a land slot to the land logic and the spell it names to the role counter', () => {
    for (const name of [FELL, SPIKEFIELD, SILUNDI]) expect(isMdfcLand(mdfc(name))).toBe(true);
    expect(countedRoleOf(mdfc(FELL))).toBe('removal');
    expect(countedRoleOf(mdfc(SPIKEFIELD))).toBe('removal');
    expect(countedRoleOf(mdfc(SILUNDI))).toBe('cardDraw');
    const counts = computeRoleCounts([mdfc(FELL), mdfc(SPIKEFIELD), mdfc(SILUNDI)]).roleCounts;
    expect(counts).toMatchObject({ removal: 2, cardDraw: 1, ramp: 0, boardwipe: 0 });
  });

  it('is counted by the generation report whichever bucket it was seated in', () => {
    const asLand = cleanCategories();
    asLand.lands.push(mdfc(FELL), mdfc(SILUNDI));
    const asSpell = cleanCategories();
    asSpell.singleRemoval.push(mdfc(FELL));
    asSpell.cardDraw.push(mdfc(SILUNDI));
    const count = (cats: ReturnType<typeof cleanCategories>) =>
      computeRoleCounts(Object.values(cats).flat()).roleCounts;
    expect(count(asLand)).toEqual(count(asSpell));

    // The report's shipped count is the recount over the whole mainboard.
    const deck = assemble(asLand, { roleCounts: count(asLand) });
    expect(checks(checkDeckInvariants(deck, context()), 'HARD')).not.toContain('report-roles');
    // A count that leaves the lands bucket out is the old generator's: HARD.
    const nonLand = computeRoleCounts(Object.values({ ...asLand, lands: [] }).flat()).roleCounts;
    expect(nonLand.removal).toBe(count(asLand).removal - 1);
    const stale = { ...deck, roleCounts: nonLand };
    expect(checks(checkDeckInvariants(stale, context()), 'HARD')).toContain('report-roles');
  });
});
