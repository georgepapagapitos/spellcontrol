import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GapAnalysisCard } from '@/deck-builder/types';

// Both owned candidates are ramp; tags/subtype neutral so the heuristic ranks
// purely on CMC closeness — letting the EDHREC index's effect stand out.
vi.mock('@/deck-builder/services/tagger/client', () => ({
  cardMatchesRole: (_name: string, role: string) => role === 'ramp',
  getCardSubtype: () => null,
  getCardTags: () => [],
}));

vi.mock('./cardSimilar', () => ({ getSimilarRank: vi.fn() }));

import { findOwnedSubstitute, type SubstituteCandidate } from './substituteFinder';
import { getSimilarRank } from './cardSimilar';

const mockedRank = vi.mocked(getSimilarRank);

const missing = { name: 'Sol Ring', role: 'ramp', cmc: 4 } as GapAnalysisCard;
// Heuristic alone prefers Hedron Archive (CMC 4 == wanted 4); Mind Stone (CMC 2)
// is the worse heuristic pick.
const pool: SubstituteCandidate[] = [
  { name: 'Hedron Archive', colorIdentity: [], cmc: 4, typeLine: 'Artifact' },
  { name: 'Mind Stone', colorIdentity: [], cmc: 2, typeLine: 'Artifact' },
];

beforeEach(() => mockedRank.mockReset());

describe('substitute finder — EDHREC similar index ranking', () => {
  it('lets the EDHREC similar rank override the heuristic CMC pick', () => {
    // EDHREC says Mind Stone is the closest substitute, Hedron Archive far down.
    mockedRank.mockReturnValue(
      new Map([
        ['Mind Stone', 0],
        ['Hedron Archive', 5],
      ])
    );
    const row = findOwnedSubstitute(missing, pool, new Set(), []);
    expect(row?.usedName).toBe('Mind Stone'); // index beat the closer-CMC heuristic pick
    expect(row?.reason).toContain('a common substitute for Sol Ring');
  });

  it('falls back to the heuristic when the staple is not indexed', () => {
    mockedRank.mockReturnValue(null);
    const row = findOwnedSubstitute(missing, pool, new Set(), []);
    expect(row?.usedName).toBe('Hedron Archive'); // closest CMC, heuristic order
    expect(row?.reason).toContain('same role');
    expect(row?.reason).not.toContain('common substitute');
  });

  it('only counts owned cards the index actually lists (others stay heuristic)', () => {
    // Mana Vault is EDHREC's top pick but unowned; among owned only Mind Stone is
    // indexed, so it wins over the unindexed (heuristically-closer) Hedron Archive.
    mockedRank.mockReturnValue(
      new Map([
        ['Mana Vault', 0],
        ['Mind Stone', 3],
      ])
    );
    const row = findOwnedSubstitute(missing, pool, new Set(), []);
    expect(row?.usedName).toBe('Mind Stone');
    expect(row?.reason).toContain('a common substitute for Sol Ring');
  });

  it('keeps every existing gate — never an in-deck or off-identity card', () => {
    mockedRank.mockReturnValue(new Map([['Mind Stone', 0]]));
    // Mind Stone already in the deck → excluded even though the index tops it.
    const row = findOwnedSubstitute(missing, pool, new Set(['Mind Stone']), []);
    expect(row?.usedName).toBe('Hedron Archive'); // the only eligible card left
  });
});
