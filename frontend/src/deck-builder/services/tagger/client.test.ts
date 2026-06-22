import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadTaggerData, getCardRole, cubeRole } from './client';

// Minimal tagger dataset: a cost-reducer (which the generic classifier folds
// into "ramp"), a genuine ramp spell, and a removal spell.
const DATA = {
  generatedAt: '2026-06-21T00:00:00Z',
  tags: {
    'cost-reducer': ['Puresteel Paladin'],
    ramp: ['Cultivate'],
    removal: ['Swords to Plowshares'],
  },
};

beforeAll(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => DATA }) as unknown as Response)
  );
  await loadTaggerData();
});

describe('cubeRole', () => {
  it('demotes a cost-reducer-only "ramp" to no role (misleading in a cube)', () => {
    expect(getCardRole('Puresteel Paladin')).toBe('ramp'); // generic tagger says ramp
    expect(cubeRole('Puresteel Paladin')).toBeNull(); // cube view: not real acceleration
  });

  it('keeps genuine ramp and unrelated roles untouched', () => {
    expect(cubeRole('Cultivate')).toBe('ramp');
    expect(cubeRole('Swords to Plowshares')).toBe('removal');
  });
});
