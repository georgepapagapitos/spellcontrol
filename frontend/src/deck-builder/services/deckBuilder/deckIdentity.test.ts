import { describe, it, expect } from 'vitest';
import { deriveDeckIdentity, engineArchetype, resolveAutoArchetype } from './deckIdentity';
import { analyzeDeckSynergy, type DeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import type { AxisKey } from '@/deck-builder/services/synergy/axes';
import { buildCommanderProfile } from './commanderProfile';
import { Archetype, type ScryfallCard, type ThemeResult } from '@/deck-builder/types';

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'id-1',
    oracle_id: 'oracle-1',
    name: 'Test Card',
    cmc: 3,
    type_line: 'Creature',
    oracle_text: '',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

function theme(name: string, isSelected = true): ThemeResult {
  return { name, source: 'edhrec', isSelected };
}

const vanillaProfile = buildCommanderProfile(
  makeCard({ name: 'Plain Bear', type_line: 'Legendary Creature — Bear', oracle_text: '' })
);

const nLands = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    makeCard({ name: `Land ${i}`, type_line: 'Basic Land — Forest', cmc: 0 })
  );

describe('deriveDeckIdentity', () => {
  it('lets explicitly selected themes drive the archetype', () => {
    const id = deriveDeckIdentity({
      profile: vanillaProfile, // commander alone → GOODSTUFF
      selectedThemes: [theme('tokens')],
      cards: [makeCard({ cmc: 3 })],
    });
    expect(id.archetypeLabel).toBe('Tokens');
    expect(id.themes).toEqual(['tokens']);
  });

  it('falls back to the commander archetype when no themes are selected', () => {
    const aristocrats = buildCommanderProfile(
      makeCard({
        name: 'Drainer',
        oracle_text: 'Whenever you gain life, each opponent loses that much life.',
      })
    );
    const id = deriveDeckIdentity({ profile: aristocrats, cards: [makeCard({ cmc: 3 })] });
    expect(id.archetypeLabel).toBe('Aristocrats');
    // No selected themes → chips come from the commander's suggestions.
    expect(id.themes.length).toBeGreaterThan(0);
  });

  it('derives pacing from the actual curve (high curve → late game)', () => {
    const id = deriveDeckIdentity({
      profile: vanillaProfile,
      cards: [...nLands(40), ...Array.from({ length: 30 }, () => makeCard({ cmc: 6 }))],
    });
    expect(id.pacingShort).toBe('Late game');
  });

  it('derives a fast-tempo pacing from a low curve', () => {
    const id = deriveDeckIdentity({
      profile: vanillaProfile,
      cards: [...nLands(35), ...Array.from({ length: 40 }, () => makeCard({ cmc: 1 }))],
    });
    expect(id.pacingShort).toBe('Fast tempo');
  });

  it('single-sources the archetype from the persisted generation value when present (S3)', () => {
    // Commander alone / selected themes would both say GOODSTUFF or TOKENS,
    // but generation actually detected ENCHANTRESS (e.g. via an EDHREC
    // dominant-theme signal this function never consults) — the persisted
    // value must win so the headline matches what was actually built.
    const id = deriveDeckIdentity({
      profile: vanillaProfile,
      selectedThemes: [theme('tokens')],
      cards: [makeCard({ cmc: 3 })],
      persistedArchetype: Archetype.ENCHANTRESS,
    });
    expect(id.archetypeLabel).toBe('Enchantress');
  });

  it('falls back to pickArchetype for manual/imported decks with no persisted archetype', () => {
    const id = deriveDeckIdentity({
      profile: vanillaProfile,
      selectedThemes: [theme('tokens')],
      cards: [makeCard({ cmc: 3 })],
    });
    expect(id.archetypeLabel).toBe('Tokens');
  });

  it('ignores unselected themes and caps chips at five', () => {
    const id = deriveDeckIdentity({
      profile: vanillaProfile,
      selectedThemes: [
        theme('tokens'),
        theme('sacrifice'),
        theme('aristocrats'),
        theme('counters'),
        theme('lifegain'),
        theme('blink'),
        theme('unselected', false),
      ],
      cards: [makeCard({ cmc: 3 })],
    });
    expect(id.themes).toHaveLength(5);
    expect(id.themes).not.toContain('unselected');
  });
});

// The strip and the stats said "Goodstuff" while the Power tab said
// "Equipment / Voltron, 28 enablers" on the same Sram deck: the label only
// ever echoed the generator's EDHREC read. On Auto it now follows the deck's
// own engine when one clearly leads.
describe("resolveAutoArchetype: the deck's engine decides Auto", () => {
  const engine = (...axes: Array<[AxisKey, number]>): DeckSynergy => ({
    axes: axes.map(([axis, total]) => ({
      axis,
      label: axis,
      producers: Array.from({ length: total - 1 }, (_, i) => ({ name: `p${i}`, reason: '' })),
      payoffs: [{ name: 'payoff', reason: '' }],
      total,
    })),
    invested: axes.filter(([, total]) => total >= 5).map(([axis]) => axis),
    warnings: [],
    headline: '',
  });
  const neutralBuild = { archetype: Archetype.GOODSTUFF, archetypeProvenance: 'neutral' as const };

  it("a decisive equipment engine reads as Voltron over the generator's Goodstuff", () => {
    expect(
      resolveAutoArchetype({
        build: neutralBuild,
        engine: engine(['equipment', 30], ['auras', 13]),
      })
    ).toBe(Archetype.VOLTRON);
  });

  it('works from the real card text: equipment plus a cast-equipment payoff', () => {
    const equipment = Array.from({ length: 6 }, (_, i) =>
      makeCard({ name: `Blade ${i}`, type_line: 'Artifact — Equipment', oracle_text: 'Equip {2}' })
    );
    const sram = makeCard({
      name: 'Sram',
      type_line: 'Legendary Creature — Dwarf Advisor',
      oracle_text: 'Whenever you cast an Aura, Equipment, or Vehicle spell, draw a card.',
    });
    expect(engineArchetype(analyzeDeckSynergy([sram, ...equipment]))).toBe(Archetype.VOLTRON);
  });

  it("keeps the generator's read when two engines run close", () => {
    expect(
      resolveAutoArchetype({
        build: neutralBuild,
        engine: engine(['equipment', 12], ['tokens', 9]),
      })
    ).toBe(Archetype.GOODSTUFF);
  });

  it('ignores an axis that is not a real engine yet', () => {
    expect(engineArchetype(engine(['equipment', 4]))).toBeUndefined();
  });

  it('never trades a named archetype for Midrange', () => {
    expect(engineArchetype(engine(['counters', 20]))).toBeUndefined();
  });

  it('a theme the owner chose at generation outranks the engine', () => {
    expect(
      resolveAutoArchetype({
        build: { archetype: Archetype.TOKENS, archetypeProvenance: 'user-theme' },
        engine: engine(['equipment', 30]),
      })
    ).toBe(Archetype.TOKENS);
  });

  it("the owner's pick outranks everything", () => {
    expect(
      resolveAutoArchetype({
        override: Archetype.ARISTOCRATS,
        build: neutralBuild,
        engine: engine(['equipment', 30]),
      })
    ).toBe(Archetype.ARISTOCRATS);
  });

  it('a hand-built deck with no engine leaves the commander guess in charge', () => {
    expect(resolveAutoArchetype({ engine: engine() })).toBeUndefined();
  });
});
