// Guard (T171 round 3): a land search read as card advantage. Scryfall's
// tagger files Elven Passage and every fetchland under `tutor` (with
// `land-tutor`), so Coach offered Elven Passage as a "Card advantage staple".
// Tag memberships mirror public/tagger-tags.json (2026-09-01).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { EDHRECCard, EDHRECCommanderData } from '@/deck-builder/types';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import { buildGapAnalysis } from './gapAnalysisBuilder';

const TAGS = {
  generatedAt: '2026-09-01T22:03:33.453Z',
  tags: {
    tutor: ['Elven Passage', 'Civic Wayfinder', 'Cultivate'],
    'land-tutor': ['Elven Passage', 'Civic Wayfinder', 'Cultivate'],
    ramp: ['Cultivate'],
    'card-advantage': ['Harmonize'],
    draw: ['Harmonize'],
    removal: ['Boseiju, Who Endures'],
  },
};

beforeAll(async () => {
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => TAGS }));
  await loadTaggerData();
});
afterAll(() => vi.unstubAllGlobals());

const row = (name: string, primary_type: string, inclusion: number): EDHRECCard =>
  ({ name, sanitized: name, primary_type, inclusion, num_decks: 0 }) as EDHRECCard;

describe('buildGapAnalysis — land searches', () => {
  it('never labels a land search as card advantage, nor a land with a spell role', () => {
    const page = {
      cardlists: {
        allNonLand: [
          row('Elven Passage', 'Land', 40),
          row('Boseiju, Who Endures', 'Land', 45),
          row('Civic Wayfinder', 'Creature', 30),
          row('Cultivate', 'Sorcery', 50),
          row('Harmonize', 'Sorcery', 35),
        ],
      },
    } as unknown as EDHRECCommanderData;
    const roles = Object.fromEntries(
      buildGapAnalysis(page, []).map((g) => [g.name, g.roleLabel ?? null])
    );
    expect(roles).toEqual({
      'Elven Passage': null,
      'Boseiju, Who Endures': null,
      'Civic Wayfinder': null,
      Cultivate: 'Ramp',
      Harmonize: 'Card advantage',
    });
  });
});
