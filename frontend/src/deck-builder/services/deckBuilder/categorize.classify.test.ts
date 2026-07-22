// classifyCardCategory / routeCardByType delegation — kept in its own file
// (rather than categorize.test.ts) because it needs the tagger role lookup
// mocked, and categorize.test.ts's existing suite relies on the REAL
// (no-tagger-data-loaded) behavior for its fallback-to-synergy assertions.
import { describe, it, expect, vi } from 'vitest';

// Tagger data isn't loaded in the test env, so validateCardRole() would
// always return null (the role branch). Mock it so classifyCardCategory's
// per-role routing is exercisable here.
vi.mock('@/deck-builder/services/tagger/client', () => ({
  validateCardRole: (card: { name: string }): string | null => {
    if (card.name === 'Sol Ring') return 'ramp';
    if (card.name === 'Swords to Plowshares') return 'removal';
    if (card.name === 'Wrath of God') return 'boardwipe';
    if (card.name === 'Rhystic Study') return 'cardDraw';
    return null;
  },
}));

import { classifyCardCategory, routeCardByType } from './categorize';
import type { ScryfallCard, DeckCategory } from '@/deck-builder/types';

function sc(name: string, type_line: string): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 2,
    type_line,
    oracle_text: '',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
  };
}

function emptyCategories(): Record<DeckCategory, ScryfallCard[]> {
  return {
    lands: [],
    ramp: [],
    cardDraw: [],
    singleRemoval: [],
    boardWipes: [],
    creatures: [],
    synergy: [],
    utility: [],
  };
}

describe('classifyCardCategory', () => {
  it('routes a land to lands', () => {
    expect(classifyCardCategory(sc('Forest', 'Basic Land — Forest'))).toBe('lands');
  });

  it('routes a creature to creatures', () => {
    expect(classifyCardCategory(sc('Bear', 'Creature — Bear'))).toBe('creatures');
  });

  it('routes a planeswalker to utility (mirrors deckGenerator)', () => {
    expect(classifyCardCategory(sc('Jace', 'Legendary Planeswalker — Jace'))).toBe('utility');
  });

  it('routes each tagger role to its category', () => {
    expect(classifyCardCategory(sc('Sol Ring', 'Artifact'))).toBe('ramp');
    expect(classifyCardCategory(sc('Swords to Plowshares', 'Instant'))).toBe('singleRemoval');
    expect(classifyCardCategory(sc('Wrath of God', 'Sorcery'))).toBe('boardWipes');
    expect(classifyCardCategory(sc('Rhystic Study', 'Enchantment'))).toBe('cardDraw');
  });

  it('falls back to synergy when untagged', () => {
    expect(classifyCardCategory(sc('Opt', 'Instant'))).toBe('synergy');
  });

  it('routeCardByType matches classifyCardCategory everywhere EXCEPT planeswalkers', () => {
    const agreeing = [
      sc('Forest', 'Basic Land — Forest'),
      sc('Bear', 'Creature — Bear'),
      sc('Sol Ring', 'Artifact'),
      sc('Opt', 'Instant'),
    ];
    const categories = emptyCategories();
    for (const card of agreeing) routeCardByType(card, categories);
    for (const card of agreeing) {
      expect(categories[classifyCardCategory(card)]).toContain(card);
    }
  });

  it('routeCardByType keeps the historical role→synergy walker routing (generation must not change without the ship gate)', () => {
    // classifyCardCategory (display) buckets walkers as utility; the
    // generation router deliberately does not — bucket membership feeds
    // later phases' cut/add eligibility, so adopting the walker branch
    // there would be composition-affecting.
    const walker = sc('Jace', 'Legendary Planeswalker — Jace');
    const categories = emptyCategories();
    routeCardByType(walker, categories);
    expect(categories.synergy).toContain(walker);
    expect(categories.utility).not.toContain(walker);
    expect(classifyCardCategory(walker)).toBe('utility');
  });
});
