import { describe, it, expect, vi } from 'vitest';
import { finalStatsPhase } from './phaseFinalStats';
import type { GenerationState } from './state';
import type { ScryfallCard } from '@/deck-builder/types';

// E126: the salt-stats block (averageSalt / saltiestCards → SaltiestPanel)
// was silently dead for months because fetchSaltIndex's parser regexed a
// `label` field EDHREC deleted — it always returned an empty Map, and this
// block no-ops on an empty map. This test wires the FIXED parser output
// (real live top/salt.json cardview shape, curled 2026-07-23) through the
// real finalStatsPhase to pin the restoration end-to-end.
vi.mock('@/deck-builder/services/edhrec/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/deck-builder/services/edhrec/client')>();
  return {
    ...actual,
    fetchSaltIndex: vi.fn(async () =>
      actual.parseSaltIndex([
        { name: 'Stasis', salt: 3.0572033898305087 },
        { name: 'Rhystic Study', salt: 2.729052466718872 },
      ])
    ),
  };
});

function card(name: string, type_line: string, cmc = 2): ScryfallCard {
  return {
    id: name.toLowerCase().replace(/\W+/g, '-'),
    oracle_id: `o-${name}`,
    name,
    type_line,
    cmc,
    color_identity: ['U'],
    legalities: { commander: 'legal' },
    prices: {},
  } as unknown as ScryfallCard;
}

describe('finalStatsPhase — salt stats restoration (E126)', () => {
  it('computes averageSalt + saltiestCards from the (fixed) salt index, lands excluded', async () => {
    const state = {
      categories: {
        enchantments: [card('Rhystic Study', 'Enchantment', 3), card('Stasis', 'Enchantment', 2)],
        creatures: [card('Mulldrifter', 'Creature — Elemental', 5)],
        lands: [card('Island', 'Basic Land — Island', 0)],
      },
    } as unknown as GenerationState;

    // Empty map passed in → the phase lazy-loads via (mocked, fixed) fetchSaltIndex.
    const stats = await finalStatsPhase(state, new Map());

    // 3 nonland cards; salt = 2.7291 + 3.0572 + 0 → avg ≈ 1.93 (2dp rounding).
    expect(stats.averageSalt).toBeCloseTo((2.729052466718872 + 3.0572033898305087) / 3, 2);
    expect(stats.saltiestCards?.map((c) => c.name)).toEqual(['Stasis', 'Rhystic Study']);
    // The land contributes neither salt nor denominator.
  });

  it('leaves salt stats absent when the index is empty (offline / fetch failure)', async () => {
    const { fetchSaltIndex } = await import('@/deck-builder/services/edhrec/client');
    vi.mocked(fetchSaltIndex).mockResolvedValueOnce(new Map());
    const state = {
      categories: { creatures: [card('Mulldrifter', 'Creature — Elemental', 5)] },
    } as unknown as GenerationState;

    const stats = await finalStatsPhase(state, new Map());
    expect(stats.averageSalt).toBeUndefined();
    expect(stats.saltiestCards).toBeUndefined();
  });
});
