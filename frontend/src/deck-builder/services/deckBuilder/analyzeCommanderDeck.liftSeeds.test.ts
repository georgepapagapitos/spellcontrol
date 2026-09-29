/**
 * E510: Coach seeds its lift pools with the commander plus up to four of the
 * deck's signature cards. The seed test used to be `synergy > 0.3` read off
 * `edhrecByName.get(card.name)`, which missed a double-faced card twice: its
 * EDHREC row is keyed by the front face (E490), and a +0.26 card never
 * cleared the subtraction threshold however specific to the commander it was.
 *
 * vi.mock calls must be top-level so Vitest's transform can hoist them.
 */
import { describe, it, expect, vi } from 'vitest';
import type { EDHRECCard, EDHRECCommanderData, ScryfallCard } from '@/deck-builder/types';

vi.mock('@/deck-builder/services/tagger/client', () => ({
  loadTaggerData: vi.fn(async () => {}),
  getCardRole: vi.fn(() => null),
  getAllCardRoles: vi.fn(() => []),
  getRampSubtype: vi.fn(() => null),
  getRemovalSubtype: vi.fn(() => null),
  getBoardwipeSubtype: vi.fn(() => null),
  getCardDrawSubtype: vi.fn(() => null),
  isMassLandDenial: vi.fn(() => false),
  isExtraTurn: vi.fn(() => false),
  hasTag: vi.fn(() => false),
  hasTaggerData: vi.fn(() => true),
  validateCardRole: vi.fn(() => null),
  isProtectionPiece: vi.fn(() => false),
}));

// Real EDHREC row: Obeka, Brute Chronologist's page (8,739 decks can play
// it), enchantments list. 27.2% vs 1.3% in the colours: +0.258, 21x.
const FABLE_ROW: EDHRECCard = {
  name: 'Fable of the Mirror-Breaker',
  sanitized: 'fable-of-the-mirror-breaker',
  primary_type: 'Enchantment',
  inclusion: (2374 / 8739) * 100,
  num_decks: 2374,
  potential_decks: 8739,
  synergy: 0.25842377865878347,
};

function edhrecData(allNonLand: EDHRECCard[]): EDHRECCommanderData {
  return {
    themes: [],
    stats: {
      avgPrice: 0,
      numDecks: 8739,
      deckSize: 81,
      manaCurve: {},
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
      landDistribution: { basic: 0, nonbasic: 0, total: 0 },
    },
    cardlists: {
      creatures: [],
      instants: [],
      sorceries: [],
      artifacts: [],
      enchantments: allNonLand,
      planeswalkers: [],
      lands: [],
      allNonLand,
    },
    similarCommanders: [],
  };
}

const fetchCardLiftPool = vi.fn(async (_name: string) => []);

vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchCommanderData: vi.fn(async () => edhrecData([FABLE_ROW])),
  fetchPartnerCommanderData: vi.fn(async () => edhrecData([FABLE_ROW])),
  fetchCardLiftPool: (name: string) => fetchCardLiftPool(name),
}));

// The substitute snapshot is a static-asset fetch; the hidden-gems pass after
// the seeds soft-fails without it, but a test must not reach for the network.
vi.mock('./cardSimilar', () => ({
  loadCardSimilar: vi.fn(async () => {}),
  getSimilarRank: vi.fn(() => null),
}));

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getGameChangerNames: vi.fn(async () => new Set<string>()),
  getCardsByNames: vi.fn(async () => new Map()),
  getFrontFaceTypeLine: vi.fn((c: { type_line?: string }) => (c.type_line ?? '').split(' // ')[0]),
  searchCards: vi.fn(async () => ({ data: [] })),
  commanderSearchIdentity: vi.fn(() => ''),
}));

const commander = {
  name: 'Obeka, Brute Chronologist',
  id: 'obeka-id',
  oracle_id: 'obeka-oracle',
  type_line: 'Legendary Creature — Ogre Wizard',
  color_identity: ['U', 'B', 'R'],
  cmc: 4,
  mana_cost: '{1}{U}{B}{R}',
  oracle_text: '{T}: The player whose turn it is may end the turn. Activate only during your turn.',
} as unknown as ScryfallCard;

const fable = {
  name: 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki',
  id: 'fable-id',
  oracle_id: 'fable-oracle',
  type_line: 'Enchantment — Saga // Enchantment Creature — Goblin Shaman',
  color_identity: ['R'],
  cmc: 3,
  mana_cost: '{2}{R}',
  oracle_text: '',
} as unknown as ScryfallCard;

describe('analyzeCommanderDeck — lift seeds', () => {
  it('seeds a double-faced signature card the subtraction threshold missed', async () => {
    const { analyzeCommanderDeck } = await import('./commanderDeckAnalysis');
    await analyzeCommanderDeck({
      commander,
      cards: [fable],
      deckSize: 99,
      colorIdentity: ['U', 'B', 'R'],
    });
    const seeds = fetchCardLiftPool.mock.calls.map(([name]) => name);
    expect(seeds).toContain('Obeka, Brute Chronologist');
    expect(seeds).toContain('Fable of the Mirror-Breaker // Reflection of Kiki-Jiki');
  });
});
