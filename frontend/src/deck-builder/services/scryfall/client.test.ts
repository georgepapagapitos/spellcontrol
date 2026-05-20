import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { isPlayableCard } from './client';

function makeCard(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: 'x',
    oracle_id: 'x',
    name: 'Arcane Signet',
    cmc: 2,
    type_line: 'Artifact',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'cmm',
    set_name: 'Commander Masters',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

describe('isPlayableCard', () => {
  it('accepts a normal printing', () => {
    expect(isPlayableCard(makeCard({ layout: 'normal' }))).toBe(true);
  });

  it('accepts a card with no layout field (defensive)', () => {
    expect(isPlayableCard(makeCard({}))).toBe(true);
  });

  it('rejects art_series — the Commander Masters Art Series Arcane Signet case', () => {
    expect(
      isPlayableCard(
        makeCard({
          layout: 'art_series',
          set: 'acmm',
          set_name: 'Commander Masters Art Series',
          legalities: { commander: 'not_legal' },
        })
      )
    ).toBe(false);
  });

  it('rejects tokens, emblems, schemes, planes, and vanguards', () => {
    for (const layout of [
      'token',
      'double_faced_token',
      'emblem',
      'scheme',
      'planar',
      'vanguard',
    ]) {
      expect(isPlayableCard(makeCard({ layout }))).toBe(false);
    }
  });

  it('accepts DFC-ish layouts that ARE real cards', () => {
    for (const layout of ['transform', 'modal_dfc', 'split', 'flip', 'adventure', 'meld']) {
      expect(isPlayableCard(makeCard({ layout }))).toBe(true);
    }
  });
});
