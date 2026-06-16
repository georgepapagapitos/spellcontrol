// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Customization } from '@/deck-builder/types';
import { DeckCustomizer } from './DeckCustomizer';

let collectionCards: { name: string }[] = [];

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  autocompleteCardName: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../store/collection', () => ({
  useCollectionStore: (sel: (s: { cards: unknown[] }) => unknown) =>
    sel({ cards: collectionCards }),
}));
vi.mock('@/deck-builder/store', () => ({
  useDeckBuilderStore: (sel: (s: unknown) => unknown) =>
    sel({ edhrecLandSuggestion: null, setUserEditedLands: vi.fn() }),
}));

function baseCustomization(overrides: Partial<Customization> = {}): Customization {
  return {
    deckFormat: 99,
    landCount: 37,
    nonBasicLandCount: 15,
    bannedCards: [],
    banLists: [],
    mustIncludeCards: [],
    tempBannedCards: [],
    tempMustIncludeCards: [],
    maxCardPrice: null,
    deckBudget: null,
    budgetOption: 'any',
    gameChangerLimit: 'unlimited',
    targetBracket: 'all',
    maxRarity: null,
    tinyLeaders: false,
    collectionMode: false,
    collectionStrategy: 'full',
    collectionOwnedPercent: 75,
    arenaOnly: false,
    scryfallQuery: '',
    comboCount: 1,
    hyperFocus: false,
    balancedRoles: true,
    ignoreOwnedBudget: false,
    ignoreOwnedRarity: false,
    currency: 'USD',
    appliedExcludeLists: [],
    appliedIncludeLists: [],
    advancedTargets: {
      curvePercentages: null,
      typePercentages: null,
      roleTargets: null,
      edhrecBlendWeight: null,
      edhrecInclusionThreshold: null,
    },
    tempoAutoDetect: true,
    tempoPacing: 'balanced',
    saltTolerance: 2,
    generationMode: 'edhrec',
    artThemeTag: '',
    historicalYear: 2005,
    permanentsOnly: false,
    ...overrides,
  };
}

beforeEach(() => {
  collectionCards = [{ name: 'Sol Ring' }, { name: 'Arcane Signet' }];
});

describe('DeckCustomizer — collection controls', () => {
  it('hides the strategy selector until collection mode is on', () => {
    render(
      <DeckCustomizer
        customization={baseCustomization({ collectionMode: false })}
        update={vi.fn()}
      />
    );
    expect(screen.queryByText('Collection strategy')).toBeNull();
  });

  it('shows the strategy selector when collection mode is on', () => {
    render(
      <DeckCustomizer
        customization={baseCustomization({ collectionMode: true })}
        update={vi.fn()}
      />
    );
    expect(screen.getByText('Collection strategy')).toBeTruthy();
    expect(screen.getByText('Only my cards')).toBeTruthy();
    expect(screen.getByText('Prioritize mine')).toBeTruthy();
  });

  it('keeps the owned-% slider hidden under the full strategy', () => {
    render(
      <DeckCustomizer
        customization={baseCustomization({ collectionMode: true, collectionStrategy: 'full' })}
        update={vi.fn()}
      />
    );
    expect(screen.queryByLabelText('Target owned percent')).toBeNull();
  });

  it('reveals the owned-% slider under the partial strategy', () => {
    render(
      <DeckCustomizer
        customization={baseCustomization({ collectionMode: true, collectionStrategy: 'partial' })}
        update={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Target owned percent')).toBeTruthy();
    expect(screen.getByText('Target owned')).toBeTruthy();
    expect(screen.getByText('75%')).toBeTruthy();
  });

  it('patches collectionStrategy when a strategy pill is clicked', () => {
    const update = vi.fn();
    render(
      <DeckCustomizer customization={baseCustomization({ collectionMode: true })} update={update} />
    );
    fireEvent.click(screen.getByText('Prioritize mine'));
    expect(update).toHaveBeenCalledWith({ collectionStrategy: 'partial' });
  });

  it('patches collectionOwnedPercent when the slider changes', () => {
    const update = vi.fn();
    render(
      <DeckCustomizer
        customization={baseCustomization({ collectionMode: true, collectionStrategy: 'partial' })}
        update={update}
      />
    );
    fireEvent.change(screen.getByLabelText('Target owned percent'), { target: { value: '50' } });
    expect(update).toHaveBeenCalledWith({ collectionOwnedPercent: 50 });
  });

  it('describes the fill-and-flag intent for the partial strategy', () => {
    render(
      <DeckCustomizer
        customization={baseCustomization({
          collectionMode: true,
          collectionStrategy: 'partial',
          collectionOwnedPercent: 60,
        })}
        update={vi.fn()}
      />
    );
    expect(screen.getByText(/~60% owned/)).toBeTruthy();
    expect(screen.getByText(/outside your collection/)).toBeTruthy();
  });
});
