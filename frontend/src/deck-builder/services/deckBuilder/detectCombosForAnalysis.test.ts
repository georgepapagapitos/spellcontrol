import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { ComboMatchResponse } from '@/types/combos';

// The card-tag snapshot loads lazily. Model it: tags exist only after
// ensureCardTags() resolves.
let tagsLoaded = false;
const ensureCardTags = vi.fn(async () => {
  tagsLoaded = true;
});
vi.mock('@/lib/card-tags', () => ({
  ensureCardTags: () => ensureCardTags(),
  isKnownCardTag: (tag: string) => tagsLoaded && tag === 'mana-rock',
  getCardTags: (name: string) => (tagsLoaded && name === 'Mind Stone' ? ['mana-rock'] : []),
}));

import { comboMatchesToDetected, detectCombosForAnalysis } from './commanderDeckAnalysis';

function resp(templateQuery: string): ComboMatchResponse {
  return {
    inDeck: [
      {
        combo: {
          id: '1-2--99',
          identity: 'U',
          produces: ['Infinite mana'],
          prerequisites: null,
          description: null,
          manaNeeded: null,
          popularity: 10,
          cardCount: 2,
          bracket: null,
          bracketTag: 'P',
          templates: ['Mana rock'],
          templateQueries: [templateQuery],
          cards: [
            { oracleId: 'a', cardName: 'Piece A', quantity: 1 },
            { oracleId: 'b', cardName: 'Piece B', quantity: 1 },
          ],
        },
        presentOracleIds: ['a', 'b'],
        missingOracleIds: [],
      },
    ],
    oneAway: [],
    almostInCollection: [],
    almostInCollectionTotal: 0,
    source: 'local',
  };
}

const deck = [
  { name: 'Mind Stone', type_line: 'Artifact', oracle_text: '', cmc: 2 },
] as unknown as ScryfallCard[];

describe('detectCombosForAnalysis', () => {
  beforeEach(() => {
    tagsLoaded = false;
    ensureCardTags.mockClear();
  });

  it('waits for the tag snapshot before resolving an otag: template', async () => {
    // Resolved too early, the combo reads unsatisfied: the persisted result
    // would keep that under a signature that never recomputes.
    expect(comboMatchesToDetected(resp('otag:mana-rock'), deck)[0].templatesSatisfied).toBe(false);
    tagsLoaded = false;
    const detected = await detectCombosForAnalysis(resp('otag:mana-rock'), deck);
    expect(ensureCardTags).toHaveBeenCalledTimes(1);
    expect(detected[0].templatesSatisfied).toBe(true);
  });

  it("doesn't load the snapshot when no template asks for an oracle tag", async () => {
    const detected = await detectCombosForAnalysis(resp('t:artifact'), deck);
    expect(ensureCardTags).not.toHaveBeenCalled();
    expect(detected[0].templatesSatisfied).toBe(true);
  });
});
