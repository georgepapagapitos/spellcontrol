/**
 * Tagger-race fix tests (audit P1 #4) — analyzeCommanderDeck.
 *
 * The bug: analyzeCommanderDeck used to call estimateBracket synchronously while
 * the boot fetch of tagger-tags.json was still in flight. Every tagger-backed
 * signal (isMassLandDenial, isExtraTurn, hasTag/counterspell, getCardRole) returned
 * false, so a deck with Armageddon / Time Warp rated B2 instead of B4. The result
 * was then cached by gradeBracketSignature and never recomputed.
 *
 * The fix: `await loadTaggerData()` at the top of analyzeCommanderDeck before any
 * tagger function is called (loadTaggerData is idempotent + de-duped; when already
 * loaded it resolves immediately). This test asserts that loadTaggerData is awaited
 * as the FIRST async step, before any tagger signal function is invoked.
 *
 * vi.mock calls must be top-level so Vitest's transform can hoist them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

// Track the order in which async steps happen — populated by side-effecting mocks.
const callLog: string[] = [];

vi.mock('@/deck-builder/services/tagger/client', () => ({
  loadTaggerData: vi.fn(async () => {
    callLog.push('loadTaggerData');
  }),
  getCardRole: vi.fn(() => {
    callLog.push('getCardRole');
    return null;
  }),
  getRampSubtype: vi.fn(() => null),
  getRemovalSubtype: vi.fn(() => null),
  getBoardwipeSubtype: vi.fn(() => null),
  getCardDrawSubtype: vi.fn(() => null),
  isMassLandDenial: vi.fn(() => {
    callLog.push('isMassLandDenial');
    return false;
  }),
  isExtraTurn: vi.fn(() => {
    callLog.push('isExtraTurn');
    return false;
  }),
  hasTag: vi.fn(() => false),
  hasTaggerData: vi.fn(() => true),
}));

vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchCommanderData: vi.fn(async () => ({
    themes: [],
    stats: {
      avgPrice: 0,
      numDecks: 10,
      deckSize: 99,
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
      landDistribution: { basic: 10, nonbasic: 27, total: 37 },
    },
    cardlists: {
      creatures: [],
      instants: [],
      sorceries: [],
      artifacts: [],
      enchantments: [],
      planeswalkers: [],
      lands: [],
      allNonLand: [],
    },
    similarCommanders: [],
  })),
  fetchPartnerCommanderData: vi.fn(async () => ({
    themes: [],
    stats: {
      avgPrice: 0,
      numDecks: 0,
      deckSize: 99,
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
      landDistribution: { basic: 10, nonbasic: 27, total: 37 },
    },
    cardlists: {
      creatures: [],
      instants: [],
      sorceries: [],
      artifacts: [],
      enchantments: [],
      planeswalkers: [],
      lands: [],
      allNonLand: [],
    },
    similarCommanders: [],
  })),
}));

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getGameChangerNames: vi.fn(async () => new Set<string>()),
  getCardsByNames: vi.fn(async () => new Map()),
  getFrontFaceTypeLine: vi.fn((c: { type_line?: string }) => c.type_line ?? ''),
  searchCards: vi.fn(async () => ({ data: [] })),
}));

const commander: ScryfallCard = {
  name: 'Atraxa, Praetors Voice',
  id: 'atraxa-id',
  oracle_id: 'atraxa-oracle',
  type_line: 'Legendary Creature — Phyrexian',
  color_identity: ['W', 'U', 'B', 'G'],
  cmc: 4,
  mana_cost: '{W}{U}{B}{G}',
  oracle_text: 'Proliferate.',
} as unknown as ScryfallCard;

beforeEach(() => {
  callLog.length = 0;
});

describe('analyzeCommanderDeck — b1 tagger race fix', () => {
  it('awaits loadTaggerData before any tagger signal function is called', async () => {
    const { analyzeCommanderDeck } = await import('./commanderDeckAnalysis');
    await analyzeCommanderDeck({
      commander,
      cards: [],
      deckSize: 99,
      colorIdentity: ['W', 'U', 'B', 'G'],
    });

    // loadTaggerData must have been called.
    const loadIdx = callLog.indexOf('loadTaggerData');
    expect(loadIdx).toBeGreaterThanOrEqual(0);

    // Every tagger signal call must appear AFTER loadTaggerData in the log.
    const signalCalls = ['getCardRole', 'isMassLandDenial', 'isExtraTurn'];
    for (const signal of signalCalls) {
      const signalIdx = callLog.indexOf(signal);
      if (signalIdx !== -1) {
        // If the signal was called at all, it must have been called after loadTaggerData.
        expect(signalIdx).toBeGreaterThan(loadIdx);
      }
    }
  });

  it('loadTaggerData is called exactly once per analyzeCommanderDeck call (idempotent)', async () => {
    const { loadTaggerData } = await import('@/deck-builder/services/tagger/client');
    const mockLoad = vi.mocked(loadTaggerData);
    mockLoad.mockClear();

    const { analyzeCommanderDeck } = await import('./commanderDeckAnalysis');
    await analyzeCommanderDeck({
      commander,
      cards: [],
      deckSize: 99,
      colorIdentity: ['W', 'U', 'B', 'G'],
    });

    // Should be called exactly once — not per-card or per-signal.
    expect(mockLoad).toHaveBeenCalledTimes(1);
  });
});
