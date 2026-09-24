import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Customization, EDHRECCard, ScryfallCard } from '@/deck-builder/types';

const fetchAverageDeckSpells = vi.fn();
vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchAverageDeckSpells: (...a: unknown[]) => fetchAverageDeckSpells(...a),
}));
const getCardsByNames = vi.fn();
vi.mock('@/deck-builder/services/scryfall/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/scryfall/client')>()),
  getCardsByNames: (...a: unknown[]) => getCardsByNames(...a),
}));

import { dialSeedPhase } from './phaseDialSeed';
import { createState } from './state';

const card = (name: string, extra: Partial<ScryfallCard> = {}): ScryfallCard =>
  ({
    name,
    cmc: 2,
    type_line: 'Creature — Goblin',
    color_identity: ['R'],
    rarity: 'common',
    legalities: { commander: 'legal' },
    prices: { usd: '1.00' },
    ...extra,
  }) as ScryfallCard;

const pooled = (name: string, inclusion: number, synergy = 0) =>
  ({ name, inclusion, synergy, primary_type: 'Creature' }) as EDHRECCard;

function stateAt(brewLevel: number, overrides: Partial<Customization> = {}) {
  const state = createState({
    commander: card('Krenko, Mob Boss'),
    partnerCommander: null,
    colorIdentity: ['R'],
    customization: {
      deckFormat: 99,
      brewLevel,
      gameChangerLimit: 'unlimited',
      targetBracket: 'all',
      budgetOption: 'any',
      ...overrides,
    } as Customization,
  });
  state.edhrecData = {
    cardlists: {
      allNonLand: [
        pooled('Goblin Chieftain', 77, 0.4),
        pooled('Goblin Bombardment', 74, 0.58),
        pooled('Skullclamp', 62, 0.05),
        pooled('Pricey Goblin', 55, 0.3),
        pooled('Fringe Goblin', 20, 0.45),
      ],
    },
  } as never;
  return state;
}

const ctx = { colorIdentity: ['R'], budgetTracker: null };
const allCards = () =>
  new Map(
    ['Goblin Chieftain', 'Goblin Bombardment', 'Skullclamp', 'Fringe Goblin'].map((n) => [
      n,
      card(n),
    ])
  ).set('Pricey Goblin', card('Pricey Goblin', { prices: { usd: '40.00' } }));
const seeded = (state: ReturnType<typeof stateAt>) =>
  Object.values(state.categories)
    .flat()
    .map((c) => c.name);

beforeEach(() => {
  fetchAverageDeckSpells.mockReset();
  getCardsByNames.mockReset().mockImplementation(async () => allCards());
});

describe('dialSeedPhase', () => {
  it('does nothing at Balanced, so the default build is untouched', async () => {
    const state = stateAt(0.5);
    const result = await dialSeedPhase(state, ctx);
    expect(seeded(state)).toEqual([]);
    expect(result.describe).toBeUndefined();
    expect(fetchAverageDeckSpells).not.toHaveBeenCalled();
  });

  it("Staples seats EDHREC's average deck, skipping what breaks a cap", async () => {
    fetchAverageDeckSpells.mockResolvedValue({
      names: ['Skullclamp', 'Pricey Goblin', 'Goblin Chieftain', 'Fringe Goblin'],
      page: 'base',
      numDecks: 4418,
    });
    const state = stateAt(0, { maxCardPrice: 5 });
    const result = await dialSeedPhase(state, ctx);

    expect(seeded(state).sort()).toEqual(['Fringe Goblin', 'Goblin Chieftain', 'Skullclamp']);
    const chieftain = state.categories.creatures.find((c) => c.name === 'Goblin Chieftain')!;
    expect(chieftain.isMustInclude).toBe(true);
    expect(chieftain.mustIncludeSource).toBe('dial');
    expect(result.reasons.get('Skullclamp')).toMatch(/average Krenko, Mob Boss deck/);
    // The note counts the final deck: one seed later lost its slot.
    const note = result.describe!((n) => n !== 'Fringe Goblin' && n !== 'Pricey Goblin');
    expect(note).toMatch(/2 of its 4 spells are in this one/);
    expect(note).toMatch(/The rest were over your settings/);
  });

  it('Leaning staples seats only cards in over half of decks', async () => {
    fetchAverageDeckSpells.mockResolvedValue({
      names: ['Skullclamp', 'Goblin Chieftain', 'Fringe Goblin'],
      page: 'base',
      numDecks: 4418,
    });
    const state = stateAt(0.25);
    await dialSeedPhase(state, ctx);
    expect(seeded(state).sort()).toEqual(['Goblin Chieftain', 'Skullclamp']);
  });

  it('Synergy seats the highest-synergy cards, not the most played', async () => {
    const state = stateAt(1);
    const result = await dialSeedPhase(state, ctx);
    expect(seeded(state).sort()).toEqual([
      'Fringe Goblin',
      'Goblin Bombardment',
      'Goblin Chieftain',
      'Pricey Goblin',
    ]);
    expect(seeded(state)).not.toContain('Skullclamp');
    expect(result.describe!(() => true)).toMatch(/Built around 4 of Krenko, Mob Boss's/);
  });

  it('says so when the average deck cannot be loaded', async () => {
    fetchAverageDeckSpells.mockResolvedValue(null);
    const state = stateAt(0);
    const result = await dialSeedPhase(state, ctx);
    expect(seeded(state)).toEqual([]);
    expect(result.note).toMatch(/Couldn't load EDHREC's average deck/);
  });
});
