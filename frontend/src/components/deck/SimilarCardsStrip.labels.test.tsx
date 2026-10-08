// @vitest-environment happy-dom
import { render, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SimilarCardsStrip } from './SimilarCardsStrip';
import {
  resetSuggestionLabelsForTests,
  setSuggestionContext,
  setSuggestionLabelsEnabled,
} from '@/lib/util/suggestion-labels';
import type { ScryfallCard } from '@/deck-builder/types';

const sent = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('@/lib/util/analytics', () => ({
  sendBeaconPayload: (p: Record<string, unknown>) => sent.push(p),
  normalizePath: (p: string) => p,
}));

vi.mock('./useSimilarCards', () => {
  const row = (name: string) => ({
    name,
    card: { name, cmc: 2, type_line: 'Sorcery' },
    ownership: 'owned',
    inclusion: 30,
    sharedAxes: [],
    freeCount: 1,
  });
  return {
    useSimilarCards: () => ({
      owned: [row('Cultivate')],
      discovery: [row('Farseek'), row('Nature’s Lore')],
      loading: false,
    }),
  };
});

const ATRAXA = '0b0a8d28-1b0f-4d3e-9a3e-5e1a5a7a1f11';

beforeEach(() => {
  sent.length = 0;
  localStorage.clear();
  resetSuggestionLabelsForTests();
  setSuggestionContext({
    id: 'deck-secret-1',
    commander: { name: "Atraxa, Praetors' Voice", oracle_id: ATRAXA } as ScryfallCard,
    partnerCommander: null,
  });
});

function renderStrip() {
  return render(
    <SimilarCardsStrip
      target={{ name: 'Rampant Growth' } as ScryfallCard}
      deckCardNames={[]}
      collectionCards={[]}
      ownershipFor={() => 'owned'}
      freeCountFor={() => 1}
      identity={['G']}
      inclusionMap={{}}
      onSwap={vi.fn()}
      enabled
    />
  );
}

describe('SimilarCardsStrip suggestion labels', () => {
  it('labels a swap with its rank across both groups', () => {
    const { container } = renderStrip();
    const buttons = container.querySelectorAll<HTMLButtonElement>('.deck-card-row-act');
    fireEvent.click(buttons[2]);
    expect(sent).toEqual([
      expect.objectContaining({ surface: 'similar-cards', action: 'shown', n: 3 }),
      expect.objectContaining({
        surface: 'similar-cards',
        action: 'accept',
        rank: 3,
        reason: 'similar',
        cardIn: 'Nature’s Lore',
        cardOut: 'Rampant Growth',
      }),
    ]);
  });

  it('sends nothing when the player opted out', () => {
    setSuggestionLabelsEnabled(false);
    const { container } = renderStrip();
    fireEvent.click(container.querySelector('.deck-card-row-act') as HTMLButtonElement);
    expect(sent).toEqual([]);
  });
});
