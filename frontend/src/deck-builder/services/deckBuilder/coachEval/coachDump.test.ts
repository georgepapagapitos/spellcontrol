import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import { countedRoleOf } from '../commanderDeckAnalysis';
import {
  card,
  CARDS,
  COMMANDER,
  loadTaggerSnapshot,
  NONBASIC_LANDS,
  SPELLS,
} from '../__fixtures__/invariant-deck';
import type { AppliedMove, CoachMove } from './applyCoachMoves';
import {
  advisedDump,
  bucketFor,
  coachChecks,
  flattenDecklist,
  projectDumpCard,
  rebuildDeck,
  stampGenerationFlags,
  type CoachDump,
} from './coachDump';

beforeAll(loadTaggerSnapshot);
afterAll(() => vi.unstubAllGlobals());

/** A panel dump of the kit's clean Tatyova deck, bucketed as generation routes. */
function tatyovaDump(): CoachDump {
  const names = [...SPELLS, ...NONBASIC_LANDS];
  while (names.length < 99) names.push(names.length % 2 ? 'Forest' : 'Island');
  const decklist: CoachDump['decklist'] = {};
  const roleCardNames: Record<string, string[]> = {};
  const roleCounts: Record<string, number> = {};
  for (const n of names) {
    const c = card(n);
    (decklist[bucketFor(c)] ??= []).push(projectDumpCard(c, 10));
    const role = countedRoleOf(c);
    if (role) {
      (roleCardNames[role] ??= []).push(n);
      roleCounts[role] = (roleCounts[role] ?? 0) + 1;
    }
  }
  return {
    commander: COMMANDER,
    variant: 'base',
    partner: null,
    colorIdentity: ['G', 'U'],
    customization: {},
    decklist,
    roleCounts,
    roleCardNames,
    stats: { totalCards: 99, totalPriceUsd: 200 },
    allNotes: { liftPicksNote: 'kept' },
    cardRelevancy: {},
  };
}

const BY_NAME = new Map<string, ScryfallCard>(CARDS);

function move(type: CoachMove['type'], name: string, outName?: string): CoachMove {
  return { rank: 1, source: 'feed', surface: 'fill-gaps', type, name, outName };
}

describe('stampGenerationFlags', () => {
  it('restores the flags a saved generated deck carries, on copies', () => {
    const cards = [
      card('Cyclonic Rift'),
      card('Counterspell'),
      card('Harmonized Trio // Brainstorm'),
    ];
    const out = stampGenerationFlags(
      cards,
      new Set(['Cyclonic Rift']),
      new Set(['Counterspell', 'Harmonized Trio'])
    );
    expect(out.map((c) => [c.name, !!c.isGameChanger, !!c.isThemeSynergyCard])).toEqual([
      ['Cyclonic Rift', true, false],
      ['Counterspell', false, true],
      ['Harmonized Trio // Brainstorm', false, true],
    ]);
    expect(cards[0].isGameChanger).toBeUndefined();
  });
});

describe('dump in', () => {
  it('flattens the bucket dict and rebuilds the full deck', () => {
    const dump = tatyovaDump();
    expect(flattenDecklist(dump.decklist)).toHaveLength(99);
    const deck = rebuildDeck(dump, BY_NAME);
    expect(deck.commander.name).toBe(COMMANDER);
    expect(deck.partner).toBeNull();
    expect(deck.cards).toHaveLength(99);
    expect(deck.cards.find((c) => c.name === 'Counterspell')?.oracle_text).toMatch(/Counter/);
  });

  it('routes a card to the bucket generation would', () => {
    expect(bucketFor(card('Forest'))).toBe('lands');
    expect(bucketFor(card('Mulldrifter'))).toBe('creatures');
    expect(bucketFor(card('Fact or Fiction'))).toBe('cardDraw');
  });
});

describe('advisedDump', () => {
  it('makes the applied moves in the same format and names them', () => {
    const dump = tatyovaDump();
    const deck = rebuildDeck(dump, BY_NAME);
    const applied: AppliedMove[] = [
      {
        order: 1,
        move: move('swap', 'Fact or Fiction', 'Harmonize'),
        added: 'Fact or Fiction',
        cut: 'Harmonize',
        cutSource: 'swap',
      },
      {
        order: 2,
        move: move('add', 'Rhystic Study'),
        added: 'Rhystic Study',
        cut: 'Negate',
        cutSource: 'replace-when-full',
        cutReason: 'Weakest copy',
      },
    ];
    const cards = deck.cards
      .filter((c) => c.name !== 'Harmonize' && c.name !== 'Negate')
      .concat([card('Fact or Fiction'), card('Rhystic Study')]);
    const out = advisedDump(
      dump,
      BY_NAME,
      { ...deck, cards },
      {
        applied,
        skipped: [],
        inclusionOf: (n) => (n === 'Rhystic Study' ? 31.5 : null),
      }
    );
    const rows = flattenDecklist(out.decklist).map((r) => r.name);
    expect(rows).toHaveLength(99);
    expect(rows).toContain('Rhystic Study');
    expect(rows).not.toContain('Harmonize');
    expect(out.decklist.cardDraw.map((r) => r.name)).toContain('Fact or Fiction');
    // The original is untouched.
    expect(flattenDecklist(dump.decklist).map((r) => r.name)).toContain('Harmonize');

    // Roles move by the applied moves only.
    const before = dump.roleCounts as Record<string, number>;
    const after = out.roleCounts as Record<string, number>;
    const delta = (role: string | null) => (role ? 1 : 0);
    expect(after.cardDraw - before.cardDraw).toBe(
      delta(countedRoleOf(card('Fact or Fiction')) === 'cardDraw' ? 'x' : null) +
        delta(countedRoleOf(card('Rhystic Study')) === 'cardDraw' ? 'x' : null) -
        delta(countedRoleOf(card('Harmonize')) === 'cardDraw' ? 'x' : null) -
        delta(countedRoleOf(card('Negate')) === 'cardDraw' ? 'x' : null)
    );

    const stats = out.stats as { totalCards: number; totalPriceUsd: number };
    expect(stats.totalCards).toBe(99);
    // The harness's price read (getCardPrice falls back to foil when usd is null).
    const usd = (n: string) => Number(getCardPrice(card(n), 'USD') ?? 0);
    expect(stats.totalPriceUsd).toBeCloseTo(
      200 + usd('Fact or Fiction') + usd('Rhystic Study') - usd('Harmonize') - usd('Negate'),
      2
    );
    expect(out.appliedCoachMoves).toHaveLength(2);
    expect(out.coachNote).toMatch(/Harmonize -> Fact or Fiction; Negate -> Rhystic Study/);
    expect((out.allNotes as Record<string, string>).liftPicksNote).toBe('kept');
    expect((out.cardRelevancy as Record<string, unknown>)['Rhystic Study']).toEqual({
      edhrecInclusionPct: 31.5,
    });
    expect(out.coachChecks).toMatchObject({
      totalCards: 99,
      expectedCards: 99,
      duplicates: [],
      offIdentity: [],
      budget: { deckBudget: null, over: false },
    });
    // The manabase report is recomputed over the advised deck (T171 re-gate:
    // it used to carry the original's counts after three rocks were cut).
    const manabase = out.manabase as { totalLands: number; lines: { color: string }[] };
    expect(manabase.totalLands).toBe(cards.filter((c) => /Land/.test(c.type_line ?? '')).length);
    expect(manabase.lines.map((l) => l.color).sort()).toEqual(['G', 'U']);
  });

  it('checks the budget, and an unpriced card fails it (T171 re-gate)', () => {
    const dump = tatyovaDump();
    dump.customization = { deckBudget: 1000 };
    expect(coachChecks(dump).budget).toMatchObject({ deckBudget: 1000, over: false });
    dump.decklist.synergy[0] = { ...dump.decklist.synergy[0], price_usd: null };
    const checks = coachChecks(dump);
    expect(checks.budget.over).toBe(true);
    expect(checks.budget.unpriced).toEqual([dump.decklist.synergy[0].name]);
    dump.customization = { deckBudget: 1 };
    dump.decklist.synergy[0] = { ...dump.decklist.synergy[0], price_usd: '5' };
    expect(coachChecks(dump).budget.over).toBe(true);
  });

  it('handles a card one move adds and a later move cuts again', () => {
    const dump = tatyovaDump();
    const deck = rebuildDeck(dump, BY_NAME);
    const applied: AppliedMove[] = [
      { order: 1, move: move('add', 'Rhystic Study'), added: 'Rhystic Study', cut: 'Negate' },
      { order: 2, move: move('add', 'Mulldrifter'), added: 'Burgeoning', cut: 'Rhystic Study' },
    ];
    const cards = deck.cards.filter((c) => c.name !== 'Negate').concat([card('Burgeoning')]);
    const out = advisedDump(
      dump,
      BY_NAME,
      { ...deck, cards },
      {
        applied,
        skipped: [],
        inclusionOf: () => null,
        resolve: (n) => BY_NAME.get(n),
      }
    );
    const rows = flattenDecklist(out.decklist).map((r) => r.name);
    expect(rows).not.toContain('Rhystic Study');
    expect(rows).toContain('Burgeoning');
    expect(rows).toHaveLength(99);
  });

  it('says so when nothing was applied, and checks catch duplicates and off-colour cards', () => {
    const dump = tatyovaDump();
    const out = advisedDump(dump, BY_NAME, rebuildDeck(dump, BY_NAME), {
      applied: [],
      skipped: [{ move: move('add', 'Lightning Bolt'), violations: ['off-identity'] }],
      inclusionOf: () => null,
    });
    expect(out.coachNote).toMatch(/unedited/);
    expect(out.skippedCoachMoves).toEqual([
      {
        coachRank: 1,
        surface: 'fill-gaps',
        type: 'add',
        name: 'Lightning Bolt',
        outName: null,
        violations: ['off-identity'],
      },
    ]);
    const bad = tatyovaDump();
    bad.decklist.synergy.push(projectDumpCard(card('Lightning Bolt'), null));
    bad.decklist.synergy.push(projectDumpCard(card('Counterspell'), null));
    const checks = coachChecks(bad);
    expect(checks.totalCards).toBe(101);
    expect(checks.duplicates).toEqual(['Counterspell']);
    expect(checks.offIdentity).toEqual(['Lightning Bolt']);
  });
});
