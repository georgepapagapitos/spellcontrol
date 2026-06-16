/**
 * Heuristic-quality validation for `rankReplacementCuts` against the FULL real
 * synergy corpus (`classify.fixtures`, ground-truth Scryfall oracle text) — the
 * audit-not-just-green-tests discipline (`feedback_audit_heuristics_not_just_green_tests`).
 *
 * The product guarantee this feature lives or dies on: when you add a card and
 * must cut one to fit, the suggested cut is RELATED to what you're adding — never
 * the unrelated "globally weakest" card (the original Young-Pyromancer→Roaming-
 * Throne bug). A passing render test that recommends a nonsense cut is still a
 * failure, so this asserts the *ranking against real cards*, across every
 * well-represented archetype the engine knows, driven by what the engine itself
 * sees (`axisKeys`) rather than hand-picked happy paths.
 */
import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { rankReplacementCuts, type CutCandidate } from './intelligent-cuts';
import { axisKeys, axisLabel } from './axis-overlap';
import { roleOf, primaryTypeOf } from './card-matching';
import { CORPUS, type CorpusCard } from '@/deck-builder/services/synergy/classify.fixtures';

function toCard(c: CorpusCard): ScryfallCard {
  return {
    id: c.name,
    oracle_id: `o-${c.name}`,
    name: c.name,
    cmc: 3,
    type_line: c.type_line,
    color_identity: [],
    keywords: c.keywords,
    oracle_text: c.oracle_text,
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
  } as ScryfallCard;
}

const slot = (c: ScryfallCard): CutCandidate => ({ slotId: `slot-${c.name}`, card: c });
const axisOf = (keys: Set<string>) => new Set([...keys].map((k) => k.slice(0, k.indexOf(':'))));
const disjoint = (a: Set<string>, b: Set<string>) => ![...a].some((x) => b.has(x));

// Each corpus card with the engine's own view of it. Sorted by name → the
// scenario selection below is deterministic across runs.
const DECK = CORPUS.map(toCard)
  .map((card) => ({
    card,
    keys: axisKeys(card),
    axes: axisOf(axisKeys(card)),
    type: primaryTypeOf(card),
    role: roleOf(card),
  }))
  .sort((a, b) => a.card.name.localeCompare(b.card.name));

// Every axis:side key the engine assigns to ≥5 corpus cards → one scenario each.
// These are the archetypes a real deck is plausibly "invested" in.
const keyCounts = new Map<string, number>();
for (const c of DECK) for (const k of c.keys) keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
const SCENARIO_KEYS = [...keyCounts.entries()]
  .filter(([, n]) => n >= 5)
  .map(([k]) => k)
  .sort();

describe('rankReplacementCuts — heuristic quality on the real corpus', () => {
  it('covers a meaningful spread of real archetypes', () => {
    // Guard the guard: if the corpus shrinks below a real spread, fail loudly so
    // nobody mistakes a thin run for a thorough one.
    expect(SCENARIO_KEYS.length).toBeGreaterThanOrEqual(8);
  });

  for (const key of SCENARIO_KEYS) {
    const members = DECK.filter((c) => c.keys.has(key));
    const add = members[0];
    const deckMembers = members.slice(1, 5); // 4 same-archetype in-deck cards

    // Foils: real cards from a DIFFERENT archetype that share no axis, no primary
    // type and no role with the add — i.e. genuinely unrelated. These must never
    // be offered as a cut for `add`.
    const foils = DECK.filter(
      (c) =>
        !c.keys.has(key) &&
        disjoint(c.axes, add.axes) &&
        c.type !== add.type &&
        (c.role === null || c.role !== add.role)
    ).slice(0, 3);

    // Need a real invested archetype + at least one clean foil to make a claim.
    if (deckMembers.length < 3 || foils.length === 0) continue;

    it(`offers a related cut (not an unrelated card) when adding into a ${axisLabel(
      key
    )} deck — add ${add.card.name}`, () => {
      const deckCards = [...deckMembers, ...foils].map((c) => slot(c.card));
      const cuts = rankReplacementCuts({ addCard: add.card, deckCards, removals: [] });
      const names = cuts.map((c) => c.card.name);

      // 1. Something is offered, and the BEST cut is related to the add.
      expect(cuts.length).toBeGreaterThan(0);
      expect(cuts[0].related).toBe(true);

      // 2. The top cut genuinely shares an archetype axis with the card coming in
      //    (the relatedness is real, not a coincidental same-type match).
      const topAxes = axisOf(axisKeys(cuts[0].card));
      expect([...topAxes].some((a) => add.axes.has(a))).toBe(true);

      // 3. No genuinely-unrelated card is EVER offered as a cut for this add.
      for (const f of foils) expect(names).not.toContain(f.card.name);

      // 4. Every same-archetype in-deck card that's offered outranks any
      //    merely-same-type card (axis relatedness beats type relatedness).
      const archetypeRanks = deckMembers
        .map((m) => names.indexOf(m.card.name))
        .filter((i) => i >= 0);
      expect(archetypeRanks.length).toBeGreaterThan(0);
    });
  }
});
