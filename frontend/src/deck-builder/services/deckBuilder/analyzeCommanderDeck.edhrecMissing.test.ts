/**
 * E-defect-2: an unreachable EDHREC used to blank the WHOLE analysis (the
 * function returned null), even though `estimateBracket` needs nothing from
 * EDHREC — Game Changers, combos, curve and roles are all local. This asserts
 * the degraded path: `fetchCommanderData`/`fetchPartnerCommanderData` throwing
 * still yields a real `bracketEstimation` (and `winConditions`), with
 * `edhrecMissing: true` telling the UI what's missing.
 *
 * vi.mock calls must be top-level so Vitest's transform can hoist them.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

vi.mock('@/deck-builder/services/tagger/client', () => ({
  loadTaggerData: vi.fn(async () => {}),
  getCardRole: vi.fn(() => null),
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

vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchCommanderData: vi.fn(async () => {
    throw new Error('EDHREC unreachable');
  }),
  fetchPartnerCommanderData: vi.fn(async () => {
    throw new Error('EDHREC unreachable');
  }),
  fetchCardLiftPool: vi.fn(async () => []),
}));

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getGameChangerNames: vi.fn(async () => new Set<string>(['Gaea’s Cradle'])),
  getCardsByNames: vi.fn(async () => new Map()),
  getFrontFaceTypeLine: vi.fn((c: { type_line?: string }) => c.type_line ?? ''),
  searchCards: vi.fn(async () => ({ data: [] })),
  commanderSearchIdentity: vi.fn(() => ''),
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

const gameChangerCard: ScryfallCard = {
  name: 'Gaea’s Cradle',
  id: 'cradle-id',
  oracle_id: 'cradle-oracle',
  type_line: 'Legendary Land',
  color_identity: [],
  cmc: 0,
  mana_cost: '',
  oracle_text: 'T: Add G for each creature you control.',
} as unknown as ScryfallCard;

describe('analyzeCommanderDeck — EDHREC unreachable degrades instead of failing', () => {
  it('still returns a real bracketEstimation, winConditions, and edhrecMissing: true', async () => {
    const { analyzeCommanderDeck } = await import('./commanderDeckAnalysis');
    const result = await analyzeCommanderDeck({
      commander,
      cards: [gameChangerCard],
      deckSize: 99,
      colorIdentity: ['W', 'U', 'B', 'G'],
    });

    expect(result).not.toBeNull();
    expect(result?.edhrecMissing).toBe(true);
    // One Game Changer card floors the bracket at 3 (packages/deck-metrics).
    expect(result?.bracketEstimation.bracket).toBe(3);
    expect(result?.winConditions).toBeDefined();
    // EDHREC-derived fields are absent, not stale/zeroed.
    expect(result?.deckGrade).toBeUndefined();
    expect(result?.gapAnalysis).toBeUndefined();
    expect(result?.planScore).toBeUndefined();
  });

  it('still computes a bracketFit plan when a target bracket is set', async () => {
    const { analyzeCommanderDeck } = await import('./commanderDeckAnalysis');
    const result = await analyzeCommanderDeck({
      commander,
      cards: [gameChangerCard],
      deckSize: 99,
      colorIdentity: ['W', 'U', 'B', 'G'],
      targetBracket: 2,
    });

    expect(result?.edhrecMissing).toBe(true);
    // Detected (3) > target (2) — a downshift plan, degraded to tagger-local
    // cuts only (no EDHREC replacement pool), never null just because of that.
    expect(result?.bracketFit).not.toBeNull();
  });
});
