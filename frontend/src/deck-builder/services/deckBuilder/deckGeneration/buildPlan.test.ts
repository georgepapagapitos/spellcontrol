// Guard (E573): the plan a deck is built to and the plan its analysis grades
// against are one derivation. Real EDHREC pages and real generated decks (the v4
// Coach corpus): Lathril's ramp target was 15 in generation and 14 in the analysis,
// and Isshin's wipe target is shaved for a board deck.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import { Archetype, type EDHRECCommanderData, type ScryfallCard } from '@/deck-builder/types';
import { COACH_CARDS } from '../__fixtures__/coach-cards.fixtures';
import fixture from '../__fixtures__/build-plan.fixture.json';
import { buildCommanderProfile } from '../commanderProfile';
import { resolveBuildPlan, wantsExtraCombat } from './buildPlan';

type FixtureDeck = (typeof fixture.decks)[keyof typeof fixture.decks];

beforeAll(async () => {
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => fixture.tagger }));
  if (!(await loadTaggerData())) throw new Error('tagger data failed to load');
});
afterAll(() => vi.unstubAllGlobals());

const real = (name: string): ScryfallCard => ({ ...COACH_CARDS[name] }) as ScryfallCard;

function page(deck: FixtureDeck): EDHRECCommanderData {
  const allNonLand = deck.rows.map(([name, inclusion]) => ({
    name,
    sanitized: String(name).toLowerCase(),
    primary_type: 'Instant',
    inclusion: Number(inclusion),
    num_decks: 0,
    synergy: 0,
  }));
  return {
    themes: [],
    stats: {
      avgPrice: 0,
      numDecks: deck.stats.numDecks,
      deckSize: 81,
      manaCurve: deck.stats.manaCurve,
      typeDistribution: {
        creature: 0,
        instant: 0,
        sorcery: 0,
        artifact: 0,
        enchantment: 0,
        land: 0,
        planeswalker: 0,
        battle: 0,
      },
      landDistribution: { basic: 0, nonbasic: 0, total: deck.stats.landTotal },
    },
    cardlists: {
      creatures: [],
      instants: allNonLand,
      sorceries: [],
      artifacts: [],
      enchantments: [],
      planeswalkers: [],
      lands: [],
      allNonLand,
    },
    similarCommanders: [],
  } as unknown as EDHRECCommanderData;
}

function planFor(
  name: keyof typeof fixture.decks,
  settings?: Partial<FixtureDeck['generated']['settings']>
) {
  const deck = fixture.decks[name];
  const commander = real(name);
  return resolveBuildPlan({
    format: 99,
    customization: { ...deck.generated.settings, ...settings } as never,
    selectedThemes: [],
    edhrecData: page(deck),
    archetypeFallback: deck.generated.archetype as Archetype,
    hasPartner: false,
    commanderWantsExtraCombat: wantsExtraCombat([commander], buildCommanderProfile(commander)),
  });
}

describe('resolveBuildPlan', () => {
  it("reproduces Lathril's generated targets, pacing and land count", () => {
    const plan = planFor('Lathril, Blade of the Elves');
    expect(plan.roleTargets).toEqual(
      fixture.decks['Lathril, Blade of the Elves'].generated.roleTargets
    );
    expect(plan.roleTargets.ramp).toBe(15);
    expect(plan.pacing).toBe('midrange');
    expect(plan.resolvedLandCount).toBe(34);
    expect(plan.landCountAutoTuned).toBe(false);
  });

  it("reproduces Isshin's generated targets, with the board deck's wipe target shaved", () => {
    const plan = planFor('Isshin, Two Heavens as One');
    expect(plan.roleTargets).toEqual(
      fixture.decks['Isshin, Two Heavens as One'].generated.roleTargets
    );
    expect(plan.wipeTargetShaved).toBe(true);
    expect(plan.roleTargets.boardwipe).toBe(1);
    expect(plan.roleTargetBreakdown.boardwipe.blended).toBe(1);
    expect(plan.resolvedLandCount).toBe(36);
  });

  it('auto-tunes the land count only while the land settings are the defaults', () => {
    const tuned = planFor('Lathril, Blade of the Elves', { landCount: 37, nonBasicLandCount: 15 });
    expect(tuned.landCountAutoTuned).toBe(true);
    expect(tuned.resolvedLandCount).toBeGreaterThanOrEqual(32);
    expect(tuned.resolvedLandCount).toBeLessThanOrEqual(40);
    expect(tuned.plannedRampCount).toBe(15);
  });

  it('grades against the pacing the player picked when auto-detect is off', () => {
    const plan = planFor('Lathril, Blade of the Elves', {
      tempoAutoDetect: false,
      tempoPacing: 'late-game',
    });
    expect(plan.pacing).toBe('late-game');
  });
});

describe('wantsExtraCombat', () => {
  it('reads an attack-trigger commander, not a go-tall elf lord', () => {
    const isshin = real('Isshin, Two Heavens as One');
    const lathril = real('Lathril, Blade of the Elves');
    expect(wantsExtraCombat([isshin], buildCommanderProfile(isshin))).toBe(true);
    expect(wantsExtraCombat([lathril], buildCommanderProfile(lathril))).toBe(false);
  });
});
