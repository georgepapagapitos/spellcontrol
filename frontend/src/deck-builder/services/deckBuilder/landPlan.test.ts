import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import {
  LAND_REMOVAL_PLAN_MIN,
  attacksLands,
  landPlanJobs,
  planJobServed,
  readDeckLandPlan,
} from './landPlan';

// Real Scryfall oracle text: the Zo-Zu list of ai-prompt-eval fixture-8 and the
// three lands a generation seated in place of its Tectonic Edge and Volatile
// Fault (owner report 2026-10-17, E1030).
const read = <T>(file: string) =>
  JSON.parse(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__', file), 'utf8')
  ) as T;
const fixture = (file: string) => read<{ cards: ScryfallCard[] }>(file).cards;
const ZOZU = read<{ decklist: string[]; controlPackage: string[]; cards: ScryfallCard[] }>(
  'zozu-deck.fixture.json'
);
const real = (name: string) => structuredClone(ZOZU.cards.find((c) => c.name === name)!);
const isLand = (c: ScryfallCard) => /\bland\b/i.test(c.type_line ?? '');
const ZOZU_SPELLS = ZOZU.decklist.map(real).filter((c) => !isLand(c));
/** The list with a red creature package in place of its land attackers: no LD plan. */
const NO_LD_SPELLS = [
  ...ZOZU_SPELLS.filter((c) => !attacksLands(c)),
  ...ZOZU.controlPackage.map(real),
];

describe('landPlanJobs', () => {
  it('reads the land-destruction lands', () => {
    for (const name of ['Tectonic Edge', 'Volatile Fault', 'Wasteland', 'Ghost Quarter']) {
      expect(landPlanJobs(real(name))).toEqual(['land-removal']);
    }
  });

  it('reads Great Furnace as an artifact land and the rest as nothing', () => {
    expect(landPlanJobs(real('Great Furnace'))).toEqual(['artifacts']);
    expect(landPlanJobs(real('Cori Mountain Monastery'))).toEqual([]);
    expect(landPlanJobs(real('Mountain'))).toEqual([]);
    // Its token is made by the spell face, not the land.
    expect(landPlanJobs(real('Lindblum, Industrial Regency // Mage Siege'))).toEqual([]);
  });

  it('leaves token makers and sacrifice outlets to the page', () => {
    // Read as plan lands in the ship gate, they cost Krenko Nykthos and Three
    // Tree City, and The Ur-Dragon its shocklands.
    const abbey = fixture('invariant-cards.fixture.json').find((c) =>
      c.name.startsWith('Westvale Abbey')
    );
    expect(abbey).toBeDefined();
    expect(landPlanJobs(abbey!)).toEqual([]);
  });

  it('never reads a spell as a plan land', () => {
    expect(landPlanJobs(real('Cleansing Wildfire'))).toEqual([]);
  });
});

describe('readDeckLandPlan', () => {
  it('reads Zo-Zu as a land-destruction deck', () => {
    expect(ZOZU_SPELLS.filter(attacksLands).length).toBeGreaterThanOrEqual(LAND_REMOVAL_PLAN_MIN);
    expect(readDeckLandPlan(ZOZU_SPELLS, [real('Zo-Zu the Punisher')]).has('land-removal')).toBe(
      true
    );
  });

  it('does not read the same red deck without its land attackers as one', () => {
    expect(NO_LD_SPELLS.length).toBeGreaterThan(60);
    expect(NO_LD_SPELLS.filter(attacksLands)).toEqual([]);
    expect(readDeckLandPlan(NO_LD_SPELLS).has('land-removal')).toBe(false);
  });

  it('protects Tectonic Edge only in the deck that destroys lands', () => {
    const ld = readDeckLandPlan(ZOZU_SPELLS);
    expect(planJobServed(real('Tectonic Edge'), ld)).toBe('land-removal');
    expect(planJobServed(real('Great Furnace'), ld)).toBeUndefined();
    expect(planJobServed(real('Tectonic Edge'), readDeckLandPlan(NO_LD_SPELLS))).toBeUndefined();
  });

  it('reads no land attackers in the other real fixture cards', () => {
    // A wipe that spares lands ("except artifacts and lands") is not an attack.
    const others = [
      ...fixture('invariant-cards.fixture.json'),
      ...fixture('muldrotha-lands.fixture.json'),
    ].filter((c) => !isLand(c));
    expect(others.filter(attacksLands).map((c) => c.name)).toEqual([]);
  });

  it('finds one land attacker in 851 real commanders, and it destroys all lands', () => {
    const { cards } = JSON.parse(
      readFileSync(
        resolve(
          dirname(fileURLToPath(import.meta.url)),
          '__fixtures__',
          'commander-profile.keywords4.fixture.json'
        ),
        'utf8'
      )
    ) as { cards: Record<string, ScryfallCard> };
    // The Argent Etchings ("except artifacts and lands") is among them.
    expect(Object.keys(cards)).toContain('Elesh Norn // The Argent Etchings');
    expect(
      Object.entries(cards)
        .filter(([, c]) => attacksLands(c))
        .map(([name]) => name)
    ).toEqual(['Myojin of Infinite Rage']);
  });
});
