import { describe, it, expect, vi } from 'vitest';
import type { ScryfallCard, GapAnalysisCard } from '@/deck-builder/types';

// Tagger data isn't loaded in the test env, so getCardRole() would always
// return null. Mock it so we control which cards have a tagged role.
vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardRole: (name: string): string | null => {
    if (name === 'Sol Ring') return 'ramp';
    if (name === 'Swords to Plowshares') return 'removal';
    return null;
  },
}));

import { computeMisfits, computeCardFitSubscore, pickReplacement, type Misfit } from './cardFit';

function card(name: string, over: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 2,
    type_line: 'Creature — Human',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...over,
  };
}

function gap(name: string, over: Partial<GapAnalysisCard> = {}): GapAnalysisCard {
  return {
    name,
    price: null,
    inclusion: 50,
    synergy: 0.2,
    typeLine: 'Creature — Human',
    ...over,
  };
}

describe('computeMisfits', () => {
  it('flags a card with ≥2 reasons (absent inclusion + absent synergy)', () => {
    // "Random Card": no inclusion, no synergy, has a role mock returning null → 3 reasons.
    const cards = [card('Random Card')];
    const misfits = computeMisfits({ cards, cardInclusionMap: {} });
    expect(misfits).toHaveLength(1);
    expect(misfits[0].reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('does not flag a healthy card (high inclusion + positive synergy + role)', () => {
    const cards = [card('Sol Ring', { type_line: 'Artifact' })];
    const misfits = computeMisfits({
      cards,
      cardInclusionMap: { 'Sol Ring': 80 },
      cardSynergyMap: { 'Sol Ring': 0.5 },
    });
    expect(misfits).toHaveLength(0);
  });

  it('needs ≥2 reasons — a single reason is not a misfit', () => {
    // Good inclusion + good synergy, but no role (1 reason) → not a misfit.
    const cards = [card('Lonely Card')];
    const misfits = computeMisfits({
      cards,
      cardInclusionMap: { 'Lonely Card': 60 },
      cardSynergyMap: { 'Lonely Card': 0.4 },
    });
    expect(misfits).toHaveLength(0);
  });

  it('excludes lands and basics from misfit scoring', () => {
    const cards = [
      card('Forest', { type_line: 'Basic Land — Forest' }),
      card('Some Nonbasic Land', { type_line: 'Land' }),
    ];
    const misfits = computeMisfits({ cards, cardInclusionMap: {} });
    expect(misfits).toHaveLength(0);
  });

  it('adds the theme-off reason only when theme membership is provided and card is off-theme', () => {
    const cards = [card('Off Theme', { type_line: 'Creature' })];
    const themeByCard = new Set<string>(['on theme']); // does not include "off theme"
    const withTheme = computeMisfits({
      cards,
      cardInclusionMap: { 'Off Theme': 60 },
      cardSynergyMap: { 'Off Theme': 0.4 },
      themeByCard,
    });
    // role-missing (1) + theme-off (1) = 2 reasons → misfit
    expect(withTheme).toHaveLength(1);
    expect(withTheme[0].reasons.some((r) => r.kind === 'theme-off')).toBe(true);

    // Without theme membership, only role-missing (1 reason) → not a misfit.
    const withoutTheme = computeMisfits({
      cards,
      cardInclusionMap: { 'Off Theme': 60 },
      cardSynergyMap: { 'Off Theme': 0.4 },
    });
    expect(withoutTheme).toHaveLength(0);
  });

  it('sorts misfits by misfitScore descending', () => {
    const cards = [
      card('Mild Misfit'), // absent incl + absent syn + role-missing
      card('Worse Misfit', { cmc: 4 }),
    ];
    const misfits = computeMisfits({
      cards,
      cardInclusionMap: { 'Mild Misfit': 3 }, // present-but-low: smaller inclusion deficit term
      cardSynergyMap: { 'Worse Misfit': -1 }, // negative synergy bumps score
    });
    expect(misfits.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < misfits.length; i++) {
      expect(misfits[i - 1].misfitScore).toBeGreaterThanOrEqual(misfits[i].misfitScore);
    }
  });

  it('attaches a same-role replacement from gap candidates', () => {
    // "Swords to Plowshares" is mocked as a removal role; make it a misfit.
    const cards = [card('Swords to Plowshares', { type_line: 'Instant' })];
    const gaps = [gap('Better Removal', { role: 'removal', typeLine: 'Instant' })];
    const misfits = computeMisfits({
      cards,
      cardInclusionMap: {}, // absent
      cardSynergyMap: {}, // absent → 2 reasons (role present, so role not counted)
      gapCandidates: gaps,
    });
    expect(misfits).toHaveLength(1);
    expect(misfits[0].suggestedReplacement?.name).toBe('Better Removal');
  });
});

describe('pickReplacement', () => {
  it('prefers same-role candidate', () => {
    const c = card('X', { type_line: 'Instant' });
    const gaps = [
      gap('Wrong Type', { role: 'ramp', typeLine: 'Artifact' }),
      gap('Right Role', { role: 'removal', typeLine: 'Sorcery' }),
    ];
    expect(pickReplacement(c, 'removal', gaps, new Set())?.name).toBe('Right Role');
  });

  it('falls back to same primary type when no role match', () => {
    const c = card('X', { type_line: 'Legendary Creature — Elf' });
    const gaps = [
      gap('A Sorcery', { typeLine: 'Sorcery' }),
      gap('A Creature', { typeLine: 'Creature — Goblin' }),
    ];
    expect(pickReplacement(c, null, gaps, new Set())?.name).toBe('A Creature');
  });

  it('returns undefined when all candidates are excluded', () => {
    const c = card('X');
    const gaps = [gap('Excluded')];
    expect(pickReplacement(c, null, gaps, new Set(['Excluded']))).toBeUndefined();
  });

  it('returns undefined with no candidates', () => {
    expect(pickReplacement(card('X'), null, undefined, new Set())).toBeUndefined();
    expect(pickReplacement(card('X'), null, [], new Set())).toBeUndefined();
  });
});

describe('computeCardFitSubscore', () => {
  const mf = (n: number): Misfit[] =>
    Array.from({ length: n }, (_, i) => ({
      card: card(`m${i}`),
      misfitScore: 10,
      reasons: [],
    }));

  it('is 100 with no misfits and no gaps', () => {
    const s = computeCardFitSubscore([], 0);
    expect(s.value).toBe(100);
    expect(s.surface).toMatch(/pulls its weight/);
  });

  it('penalizes 8 per misfit, capped at 40', () => {
    expect(computeCardFitSubscore(mf(3), 0).value).toBe(100 - 24);
    // 10 misfits would be 80, but capped at 40.
    expect(computeCardFitSubscore(mf(10), 0).value).toBe(60);
  });

  it('penalizes 1.5 per gap, capped at 20', () => {
    expect(computeCardFitSubscore([], 4).value).toBe(100 - 6);
    expect(computeCardFitSubscore([], 100).value).toBe(80);
  });

  it('never drops below 0', () => {
    expect(computeCardFitSubscore(mf(100), 100).value).toBe(40); // 100-40-20
    expect(computeCardFitSubscore(mf(100), 100).value).toBeGreaterThanOrEqual(0);
  });
});
