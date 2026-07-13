import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useDeckBuilderStore } from './index';
import type { ScryfallCard, ThemeResult } from '@/deck-builder/types';

// Whole-state snapshot taken before any test mutates it — action closures
// are captured at store-create time, so replacing state with this is a clean
// reset.
const initialState = { ...useDeckBuilderStore.getState() };

const store = () => useDeckBuilderStore.getState();

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return { name: 'C', id: 'id', color_identity: [], ...overrides } as ScryfallCard;
}

beforeEach(() => {
  localStorage.clear();
  useDeckBuilderStore.setState(initialState, true);
});

describe('useDeckBuilderStore — defaults', () => {
  it('defaults collectionStrategy to free copies (available), not owned-any', () => {
    expect(store().customization.collectionStrategy).toBe('available');
  });
});

describe('useDeckBuilderStore — commander selection', () => {
  it('setCommander derives the combined color identity and resets theme state', () => {
    store().setEdhrecThemes([{ name: 'tokens', count: 1 } as never]);
    store().setCommander(card({ color_identity: ['U', 'R'] }));
    const s = store();
    expect(s.commander?.color_identity).toEqual(['U', 'R']);
    expect(s.colorIdentity.sort()).toEqual(['R', 'U']);
    expect(s.edhrecThemes).toEqual([]);
    expect(s.themeSource).toBe('local');
  });

  it('setPartnerCommander merges both color identities', () => {
    store().setCommander(card({ color_identity: ['W'] }));
    store().setPartnerCommander(card({ color_identity: ['B'] }));
    expect(store().colorIdentity.sort()).toEqual(['B', 'W']);
  });

  it('setCommander(null) clears the commander', () => {
    store().setCommander(card({ color_identity: ['G'] }));
    store().setCommander(null);
    expect(store().commander).toBeNull();
    expect(store().colorIdentity).toEqual([]);
  });
});

describe('useDeckBuilderStore — theme state', () => {
  it('setEdhrecThemes flips the source to edhrec', () => {
    store().setEdhrecThemes([{ name: 'aristocrats', count: 5 } as never]);
    expect(store().themeSource).toBe('edhrec');
    expect(store().edhrecThemes).toHaveLength(1);
  });

  it('toggleThemeSelection flips a single theme', () => {
    const themes: ThemeResult[] = [
      { name: 'tokens', isSelected: false } as ThemeResult,
      { name: 'lifegain', isSelected: false } as ThemeResult,
    ];
    store().setSelectedThemes(themes);
    store().toggleThemeSelection('tokens');
    const sel = store().selectedThemes;
    expect(sel.find((t) => t.name === 'tokens')?.isSelected).toBe(true);
    expect(sel.find((t) => t.name === 'lifegain')?.isSelected).toBe(false);
  });

  it('setThemesError forces the source back to local', () => {
    store().setEdhrecThemes([]);
    expect(store().themeSource).toBe('edhrec');
    store().setThemesError('boom');
    expect(store().themesError).toBe('boom');
    expect(store().themeSource).toBe('local');
  });

  it('setThemesError(null) leaves the source untouched', () => {
    store().setEdhrecThemes([]);
    store().setThemesError(null);
    expect(store().themeSource).toBe('edhrec');
  });
});

describe('useDeckBuilderStore — customization persistence', () => {
  it('updateCustomization merges and persists banned cards', () => {
    store().updateCustomization({ bannedCards: ['Sol Ring'] });
    expect(store().customization.bannedCards).toEqual(['Sol Ring']);
    expect(JSON.parse(localStorage.getItem('mtg-deck-builder-banned-cards')!)).toEqual([
      'Sol Ring',
    ]);
  });

  it('updateCustomization persists currency and arena-only as plain strings', () => {
    store().updateCustomization({ currency: 'EUR', arenaOnly: true });
    expect(localStorage.getItem('mtg-deck-builder-currency')).toBe('EUR');
    expect(localStorage.getItem('mtg-deck-builder-arena-only')).toBe('true');
  });

  it('updateCustomization leaves unrelated fields and storage alone', () => {
    store().updateCustomization({ landCount: 40 });
    expect(store().customization.landCount).toBe(40);
    expect(localStorage.getItem('mtg-deck-builder-banned-cards')).toBeNull();
  });
});

describe('useDeckBuilderStore — deck history', () => {
  it('pushDeckHistory prepends an entry with a generated id + timestamp', () => {
    store().pushDeckHistory({ action: 'add', cardName: 'Llanowar Elves' });
    const [entry] = store().deckHistory;
    expect(entry.cardName).toBe('Llanowar Elves');
    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeGreaterThan(0);
  });

  it('caps history at 50 entries, newest first', () => {
    for (let i = 0; i < 55; i++) {
      store().pushDeckHistory({ action: 'add', cardName: `Card ${i}` });
    }
    const hist = store().deckHistory;
    expect(hist).toHaveLength(50);
    expect(hist[0].cardName).toBe('Card 54');
  });

  it('clearDeckHistory empties the list', () => {
    store().pushDeckHistory({ action: 'add', cardName: 'X' });
    store().clearDeckHistory();
    expect(store().deckHistory).toEqual([]);
  });
});

describe('useDeckBuilderStore — loading / error / reset', () => {
  it('setLoading tracks the flag and message', () => {
    store().setLoading(true, 'Generating…');
    expect(store().isLoading).toBe(true);
    expect(store().loadingMessage).toBe('Generating…');
    store().setLoading(false);
    expect(store().loadingMessage).toBe('');
  });

  it('setError stores the message', () => {
    store().setError('failed');
    expect(store().error).toBe('failed');
  });

  it('reset clears commander/deck state but keeps customization', () => {
    store().updateCustomization({ landCount: 41 });
    store().setCommander(card({ color_identity: ['R'] }));
    store().setLoading(true, 'busy');
    store().reset();
    const s = store();
    expect(s.commander).toBeNull();
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
    // Customization survives a reset.
    expect(s.customization.landCount).toBe(41);
  });
});

describe('useDeckBuilderStore — swapDeckCard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is a no-op when there is no generated deck', () => {
    expect(() => store().swapDeckCard(card({ name: 'A' }), card({ name: 'B' }))).not.toThrow();
    expect(store().generatedDeck).toBeNull();
  });

  it('applies a successful swap to the generated deck', () => {
    const deck = {
      commander: null,
      partnerCommander: null,
      categories: {
        lands: [],
        ramp: [],
        cardDraw: [],
        singleRemoval: [],
        boardWipes: [],
        creatures: [card({ name: 'Old Creature', type_line: 'Creature — Elf' })],
        synergy: [],
        utility: [],
      },
      stats: {
        totalCards: 1,
        averageCmc: 0,
        manaCurve: {},
        colorDistribution: {},
        typeDistribution: {},
      },
    };
    useDeckBuilderStore.setState({ generatedDeck: deck as never });
    store().swapDeckCard(
      card({ name: 'Old Creature', type_line: 'Creature — Elf' }),
      card({ name: 'New Creature', type_line: 'Creature — Goblin' })
    );
    const names = store().generatedDeck!.categories.creatures.map((c) => c.name);
    expect(names).toContain('New Creature');
    expect(names).not.toContain('Old Creature');
  });
});
