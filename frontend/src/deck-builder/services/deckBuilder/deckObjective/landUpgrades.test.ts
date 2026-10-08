// @vitest-environment node
//
// E509: an owned nonbasic land the page never ranked takes a basic's slot when
// the mana needs it. Meren's real treatment deck holds 17 Swamps and one
// Forest next to every Golgari dual; three of the duals go back to Swamps
// here and are offered as the collection's off-page lands.
import { describe, expect, it } from 'vitest';
import { applyMove } from './judge';
import { optimizeDeck } from './optimizer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ScryfallCard } from '@/deck-builder/types';
import { readFacts } from './factsReading';
import {
  landUpgrades,
  losesShortSource,
  nonbasicLands,
  sacrificesLandsToEnter,
  withinNonbasicCeiling,
} from './landUpgrades';
import { TREATMENT, card, merenCtx, swap } from './__fixtures__/objectiveFixture';

const DUALS = ['Overgrown Tomb', 'Woodland Cemetery', 'Llanowar Wastes'];
const swapped = DUALS.reduce((d, name) => swap(d, name, 'Swamp'), TREATMENT);
// A "lean on mine" build that owns the whole deck and the three duals.
const owned = () =>
  merenCtx({
    ownedNames: new Set([...swapped.cards.map((c) => c.name), ...DUALS]),
    customization: {
      deckFormat: 99,
      currency: 'USD',
      collectionMode: true,
      collectionStrategy: 'prefer',
    },
  });
const SMALL = { maxSwaps: 3, maxEvaluations: 60, shortlist: 12, escapes: 0, comboPairs: false };

describe('landUpgrades', () => {
  const ctx = merenCtx();

  it('pairs a land with the most numerous basic it shares a colour with and the most numerous it does not', () => {
    const named = (land: string) =>
      landUpgrades(swapped, [card(land)], ctx).map((u) => swapped.cards[u.out].name);
    // Gaea's Cradle taps for green: it replaces the Forest, or a surplus Swamp.
    expect(named("Gaea's Cradle")).toEqual(['Forest', 'Swamp']);
    // A Swamp-and-Forest land shares both colours: the Swamps give way.
    expect(named('Exotic Orchard')).toHaveLength(1);
  });

  it('skips a land the deck already holds and any basic', () => {
    expect(landUpgrades(swapped, [card('Command Tower'), card('Forest')], ctx)).toEqual([]);
  });
});

describe('optimizeDeck with owned lands the page never ranked', { timeout: 60_000 }, () => {
  const pool = DUALS.map(card);

  it('seats an owned dual for a Swamp when the mana needs it', () => {
    const r = optimizeDeck(swapped, pool, owned(), {
      ...SMALL,
      landUpgrades: true,
      offPageOwned: new Set(DUALS),
    });
    const landIns = r.swaps.filter((s) => s.in.some((n) => DUALS.includes(n)));
    expect(landIns.length).toBeGreaterThan(0);
    for (const s of landIns) {
      expect(s.out).toEqual(['Swamp']);
      expect(s.terms.mana).toBeGreaterThan(0);
    }
  });

  it('keeps the land upgrades off the spell swaps budget', () => {
    const r = optimizeDeck(swapped, [...pool, card('Counterspell'), card('Grave Pact')], owned(), {
      ...SMALL,
      maxSwaps: 1,
      landUpgrades: true,
      offPageOwned: new Set(DUALS),
    });
    const lands = r.swaps.filter((s) => s.in.some((n) => DUALS.includes(n)));
    expect(lands.length).toBeGreaterThan(1);
  });

  it('leaves the basics alone without the option: the land count and mix are the plan', () => {
    const r = optimizeDeck(swapped, pool, owned(), SMALL);
    expect(
      r.swaps.filter((s) => s.out.includes('Swamp') && s.in.some((n) => DUALS.includes(n)))
    ).toEqual([]);
  });
});

// E509 gate 9: three defects, each on the real card.
const GATE9 = JSON.parse(
  readFileSync(resolve(__dirname, '__fixtures__/gate9-lands.fixture.json'), 'utf8')
) as { cards: ScryfallCard[] };
const FACELESS = (
  JSON.parse(
    readFileSync(
      resolve(__dirname, '../../../../lib/mana-sim/__fixtures__/land-abilities.fixture.json'),
      'utf8'
    )
  ) as { cards: ScryfallCard[] }
).cards.find((c) => c.name === 'Faceless Haven')!;
const gate9 = (name: string) => GATE9.cards.find((c) => c.name === name)!;

describe('a land animated only by snow mana feeds no creature-type payoff', () => {
  const c = merenCtx();
  const nonMana = (card: ScryfallCard) =>
    readFacts(card, c.factsOf(card)).produces.filter((p) => p.r !== 'mana');

  it('Faceless Haven ({S}{S}{S}) keeps its mana and nothing else', () => {
    expect(nonMana(FACELESS)).toEqual([]);
  });

  it('Mutavault ({1}) still reads as a creature', () => {
    expect(nonMana(gate9('Mutavault')).length).toBeGreaterThan(0);
  });
});

describe('sacrificesLandsToEnter', () => {
  it('reads Scorched Ruins, and not Gemstone Caverns or Mutavault', () => {
    expect(sacrificesLandsToEnter(gate9('Scorched Ruins'))).toBe(true);
    expect(sacrificesLandsToEnter(gate9('Gemstone Caverns'))).toBe(false);
    expect(sacrificesLandsToEnter(gate9('Mutavault'))).toBe(false);
  });
});

describe('the nonbasic ceiling and the colour a land move gives up', () => {
  const owned = (nonBasicLandCount: number) =>
    merenCtx({
      customization: { deckFormat: 99, currency: 'USD', nonBasicLandCount },
    });
  const have = nonbasicLands(swapped);
  const move = {
    out: [swapped.cards.findIndex((x) => x.name === 'Swamp')],
    in: [card('Overgrown Tomb')],
  };

  it('allows a basic for a nonbasic only under nonBasicLandCount', () => {
    expect(withinNonbasicCeiling(swapped, move, owned(have))).toBe(false);
    expect(withinNonbasicCeiling(swapped, move, owned(have + 1))).toBe(true);
  });

  it('always allows a nonbasic for a nonbasic', () => {
    const out = swapped.cards.findIndex((x) => x.name === 'Boseiju, Who Endures');
    expect(
      withinNonbasicCeiling(swapped, { out: [out], in: [card('Overgrown Tomb')] }, owned(have))
    ).toBe(true);
  });

  it('refuses the last green sources of a deck short of green for a colourless land', () => {
    const GREEN = [
      'Overgrown Tomb',
      'Woodland Cemetery',
      'Llanowar Wastes',
      'Tainted Wood',
      'Deathcap Glade',
      'Necroblossom Snarl',
      'Twilight Mire',
      'Golgari Rot Farm',
      'Undergrowth Stadium',
      'Command Tower',
      'Boseiju, Who Endures',
    ];
    const starved = GREEN.reduce(
      (d, name) => (d.cards.some((c) => c.name === name) ? swap(d, name, 'Swamp') : d),
      swapped
    );
    const forest = starved.cards.findIndex((x) => x.name === 'Forest');
    const bare = applyMove(starved, { out: [forest], in: [card('High Market')] });
    expect(losesShortSource(starved, bare, merenCtx())).toBe(true);
    const dual = applyMove(starved, { out: [forest], in: [card('Overgrown Tomb')] });
    expect(losesShortSource(starved, dual, merenCtx())).toBe(false);
  });
});
