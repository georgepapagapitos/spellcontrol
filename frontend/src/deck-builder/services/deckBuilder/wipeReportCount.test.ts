// @vitest-environment node
//
// E553: the wipe count behind the wipe-asymmetry note and the role count on the
// report are one number. The note counted cards the tagger tags as a wipe
// (`getCardRole`); the report counted the role each card is counted under
// (`countedRoleOf`, checked against the card's own text). Living Death is
// tagged boardwipe but its text gives it no wipe evidence, so the two reports
// of one deck disagreed. Real Scryfall records (the objective fixture) and the
// pinned tagger snapshot.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getCardRole } from '@/deck-builder/services/tagger/client';
import { computeRoleCounts } from './commanderDeckAnalysis';
import { countFinalWipeAsymmetry } from './deckGenerator';
import { loadTaggerSnapshot } from './__fixtures__/invariant-deck';
import { cards } from './deckObjective/__fixtures__/objectiveFixture';

beforeAll(loadTaggerSnapshot);
afterAll(() => vi.unstubAllGlobals());

describe('countFinalWipeAsymmetry counts the report wipes', () => {
  const deck = cards('Wrath of God', 'Living Death', 'Liliana, Dreadhorde General', 'Farewell');

  it('the fixture cards really are tagged as wipes the report does not count', () => {
    expect(getCardRole('Living Death')).toBe('boardwipe');
    expect(getCardRole('Liliana, Dreadhorde General')).toBe('boardwipe');
    expect(computeRoleCounts(deck).roleCounts.boardwipe).toBe(2);
  });

  it('totals the same wipes roleCounts does', () => {
    const { totalCount } = countFinalWipeAsymmetry(deck, true);
    expect(totalCount).toBe(computeRoleCounts(deck).roleCounts.boardwipe);
  });
});
