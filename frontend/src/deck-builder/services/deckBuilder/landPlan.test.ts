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
const ZOZU = read<{
  decklist: string[];
  seated: string[];
  controlPackage: string[];
  cards: ScryfallCard[];
}>('zozu-deck.fixture.json');
const ZOZU_SEATED = ZOZU.seated;
const real = (name: string) => structuredClone(ZOZU.cards.find((c) => c.name === name)!);
const isLand = (c: ScryfallCard) => /\bland\b/i.test(c.type_line ?? '');
const ZOZU_SPELLS = ZOZU.decklist.map(real).filter((c) => !isLand(c));
/** The list with a red creature package in place of its land attackers: no LD plan. */
const NO_LD_SPELLS = [
  ...ZOZU_SPELLS.filter((c) => !attacksLands(c)),
  ...ZOZU.controlPackage.map(real),
];

// Real Scryfall oracle text for three more land-synergy decks (E1033): landfall
// (Omnath, Locus of Rage), land recursion (Titania, Protector of Argoth) and
// Gates. Each lists the spells that make its plan, the lands that serve it, and
// lands that only add color or value.
interface SynergyDeck {
  commander: string;
  spells: string[];
  planLands: string[];
  genericLands: string[];
}
const SYNERGY = read<{ decks: Record<string, SynergyDeck>; cards: ScryfallCard[] }>(
  'land-synergy.fixture.json'
);
const card = (name: string) => structuredClone(SYNERGY.cards.find((c) => c.name === name)!);
const ARCHETYPES: [string, string][] = [
  ['landfall', 'more-lands'],
  ['recursion', 'land-recursion'],
  ['gates', 'land-type:gate'],
];
/** The deck's spells that carry no land job of their own, without the commander. */
const planless = (deck: SynergyDeck) =>
  deck.spells.map(card).filter((c) => readDeckLandPlan([], [c]).size === 0);

describe('landPlanJobs', () => {
  it('reads the land-destruction lands', () => {
    for (const name of ['Tectonic Edge', 'Volatile Fault', 'Wasteland', 'Ghost Quarter']) {
      expect(landPlanJobs(real(name))).toContain('land-removal');
    }
  });

  it('reads Great Furnace as an artifact land and the rest as nothing Zo-Zu builds on', () => {
    const zozu = readDeckLandPlan(ZOZU_SPELLS, [real('Zo-Zu the Punisher')]);
    expect(landPlanJobs(real('Great Furnace'))).toEqual(['artifacts']);
    expect(landPlanJobs(real('Cori Mountain Monastery'))).toEqual([]);
    expect(landPlanJobs(real('Mountain'))).toEqual([]);
    // A Town: it serves a deck that names Towns, not this one.
    expect(landPlanJobs(real('Lindblum, Industrial Regency // Mage Siege'))).toEqual([
      'land-type:town',
    ]);
    for (const name of ZOZU_SEATED) expect(planJobServed(real(name), zozu)).toBeUndefined();
  });

  it.each(ARCHETYPES)('reads the %s lands, and not the generic ones', (deck, job) => {
    const d = SYNERGY.decks[deck];
    for (const name of d.planLands) expect(landPlanJobs(card(name))).toContain(job);
    for (const name of d.genericLands) expect(landPlanJobs(card(name))).not.toContain(job);
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

  it.each(ARCHETYPES)('reads the %s deck as %s, and its plan lands as serving it', (deck, job) => {
    const d = SYNERGY.decks[deck];
    const plan = readDeckLandPlan(d.spells.map(card), [card(d.commander)]);
    expect(plan.has(job as never)).toBe(true);
    for (const name of d.planLands) expect(planJobServed(card(name), plan)).toBeDefined();
    for (const name of d.genericLands) expect(planJobServed(card(name), plan)).toBeUndefined();
  });

  it.each(ARCHETYPES)('reads no plan in the %s deck without its plan spells', (deck) => {
    const d = SYNERGY.decks[deck];
    const control = planless(d);
    expect(control.length).toBeGreaterThan(0);
    expect([...readDeckLandPlan(control)]).toEqual([]);
  });

  it('reads no land plan in a red deck without one, and none of these lands serve it', () => {
    const plan = readDeckLandPlan(NO_LD_SPELLS);
    expect([...plan]).toEqual([]);
    for (const c of SYNERGY.cards) expect(planJobServed(c, plan)).toBeUndefined();
  });

  it('reads land commanders as their own plan, and nothing in most commanders', () => {
    const { cards } = read<{ cards: Record<string, ScryfallCard> }>(
      'commander-profile.keywords4.fixture.json'
    );
    const planOf = (name: string) => [...readDeckLandPlan([], [cards[name]])];
    expect(planOf('Omnath, Locus of Rage')).toEqual(['more-lands']);
    expect(planOf('Tatyova, Benthic Druid')).toEqual(['more-lands']);
    expect(planOf('Hazezon, Shaper of Sand')).toContain('land-type:desert');
    expect(planOf('Mishra, Claimed by Gix')).toEqual([]);
    const withPlan = Object.values(cards).filter((c) => readDeckLandPlan([], [c]).size > 0);
    expect(withPlan.length).toBeLessThan(Object.keys(cards).length / 15);
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
