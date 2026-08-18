// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Customization } from '@/deck-builder/types';
import { getBanList } from '@/deck-builder/services/scryfall/client';
import { DeckCustomizer } from './DeckCustomizer';

let collectionCards: { name: string }[] = [];

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  autocompleteCardName: vi.fn().mockResolvedValue([]),
  getBanList: vi.fn().mockResolvedValue([]),
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
    balancedRoles: true,
    ignoreOwnedBudget: false,
    ignoreOwnedRarity: false,
    currency: 'USD',
    appliedExcludeLists: [],
    appliedIncludeLists: [],
    tempoAutoDetect: true,
    tempoPacing: 'balanced',
    saltTolerance: 2,
    generationMode: 'edhrec',
    artThemeTag: '',
    historicalYear: 2005,
    permanentsOnly: false,
    brewLevel: 0.5,
    ...overrides,
  };
}

beforeEach(() => {
  collectionCards = [{ name: 'Sol Ring' }, { name: 'Arcane Signet' }];
  vi.mocked(getBanList).mockReset().mockResolvedValue([]);
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

describe('DeckCustomizer — Staples <-> Theme dial (always visible)', () => {
  it('shows Balanced with its description at the 0.5 default', () => {
    render(<DeckCustomizer customization={baseCustomization()} update={vi.fn()} />);
    expect(screen.getByLabelText(/Staples to Theme dial/)).toBeTruthy();
    expect(screen.getAllByText('Balanced').length).toBeGreaterThan(0);
    expect(screen.getByText(/even mix of proven staples/)).toBeTruthy();
  });

  it('shows the Staples label and description at 0', () => {
    render(<DeckCustomizer customization={baseCustomization({ brewLevel: 0 })} update={vi.fn()} />);
    expect(screen.getAllByText('Staples').length).toBeGreaterThan(0);
    expect(screen.getByText(/EDHREC's most-played picks/)).toBeTruthy();
  });

  it('shows the Theme label and description at 1', () => {
    render(<DeckCustomizer customization={baseCustomization({ brewLevel: 1 })} update={vi.fn()} />);
    expect(screen.getAllByText('Theme').length).toBeGreaterThan(0);
    expect(screen.getByText(/commander's mechanics/)).toBeTruthy();
  });

  it('patches brewLevel when the slider changes', () => {
    const update = vi.fn();
    render(<DeckCustomizer customization={baseCustomization()} update={update} />);
    fireEvent.change(screen.getByLabelText(/Staples to Theme dial/), {
      target: { value: '0.75' },
    });
    expect(update).toHaveBeenCalledWith({ brewLevel: 0.75 });
  });

  it('resets brewLevel with Reset all', () => {
    const update = vi.fn();
    render(<DeckCustomizer customization={baseCustomization({ brewLevel: 1 })} update={update} />);
    fireEvent.click(screen.getByTitle('Reset all customization to defaults'));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ brewLevel: 0.5 }));
  });
});

describe('DeckCustomizer — collapsed group summaries', () => {
  it('shows each collapsed group’s current setting in its header', () => {
    render(
      <DeckCustomizer
        customization={baseCustomization({
          deckBudget: 50,
          maxCardPrice: 5,
          saltTolerance: 0,
          maxRarity: 'rare',
        })}
        update={vi.fn()}
      />
    );
    expect(screen.getByText('$50 deck · $5 card')).toBeTruthy();
    expect(screen.getByText('Unsalted')).toBeTruthy();
    expect(screen.getByText('Auto-detect')).toBeTruthy();
    expect(screen.getByText('Rare max')).toBeTruthy();
    expect(screen.getByText('None')).toBeTruthy();
  });

  it('shows neutral defaults when nothing is set', () => {
    render(<DeckCustomizer customization={baseCustomization()} update={vi.fn()} />);
    expect(screen.getByText('No limits')).toBeTruthy();
    expect(screen.getByText('Any card')).toBeTruthy();
  });

  it('hides the summary while the group is open', () => {
    render(
      <DeckCustomizer customization={baseCustomization({ deckBudget: 50 })} update={vi.fn()} />
    );
    fireEvent.click(screen.getByText('Budget'));
    expect(screen.queryByText(/\$50 deck/)).toBeNull();
  });
});

describe('DeckCustomizer — Arena only / Tiny Leaders', () => {
  function openPool() {
    fireEvent.click(screen.getByText('Card pool'));
  }

  it('patches arenaOnly and tinyLeaders from the pool group', () => {
    const update = vi.fn();
    render(<DeckCustomizer customization={baseCustomization()} update={update} />);
    openPool();
    fireEvent.click(screen.getByLabelText(/Arena only/));
    expect(update).toHaveBeenCalledWith({ arenaOnly: true });
    fireEvent.click(screen.getByLabelText(/Tiny Leaders/));
    expect(update).toHaveBeenCalledWith({ tinyLeaders: true });
  });

  it('names both in the collapsed pool summary when on', () => {
    render(
      <DeckCustomizer
        customization={baseCustomization({ arenaOnly: true, tinyLeaders: true })}
        update={vi.fn()}
      />
    );
    expect(screen.getByText('Arena only · Tiny Leaders')).toBeTruthy();
  });

  it('clears both with Reset all', () => {
    const update = vi.fn();
    render(
      <DeckCustomizer
        customization={baseCustomization({ arenaOnly: true, tinyLeaders: true, banLists: [] })}
        update={update}
      />
    );
    fireEvent.click(screen.getByTitle('Reset all customization to defaults'));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ arenaOnly: false, tinyLeaders: false, banLists: [] })
    );
  });
});

describe('DeckCustomizer — ban-list presets', () => {
  function openBanLists() {
    fireEvent.click(screen.getByText('Ban lists'));
  }

  it('applies a fetched preset as an enabled ban list', async () => {
    vi.mocked(getBanList).mockResolvedValue(['Black Lotus', 'Channel']);
    const update = vi.fn();
    render(<DeckCustomizer customization={baseCustomization()} update={update} />);
    openBanLists();
    fireEvent.click(screen.getByText('Commander'));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(getBanList).toHaveBeenCalledWith('commander');
    expect(update).toHaveBeenCalledWith({
      banLists: [
        {
          id: 'commander',
          name: 'Commander',
          cards: ['Black Lotus', 'Channel'],
          isPreset: true,
          enabled: true,
        },
      ],
    });
  });

  it('shows the card count on an applied preset and drops it on re-click', () => {
    const update = vi.fn();
    render(
      <DeckCustomizer
        customization={baseCustomization({
          banLists: [
            { id: 'brawl', name: 'Brawl', cards: ['Sol Ring'], isPreset: true, enabled: true },
          ],
        })}
        update={update}
      />
    );
    openBanLists();
    const chip = screen.getByText('Brawl (1)');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip);
    expect(update).toHaveBeenCalledWith({ banLists: [] });
  });

  it('surfaces a retryable message when the fetch fails', async () => {
    vi.mocked(getBanList).mockRejectedValue(new Error('offline'));
    const update = vi.fn();
    render(<DeckCustomizer customization={baseCustomization()} update={update} />);
    openBanLists();
    fireEvent.click(screen.getByText('Pauper EDH'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Couldn't load the Pauper EDH ban list/)).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('DeckCustomizer — Mana philosophy (E234)', () => {
  function openManaPhilosophy() {
    fireEvent.click(screen.getByText('Mana philosophy'));
  }

  it('stays unset by default — Off, no sliders rendered', () => {
    render(<DeckCustomizer customization={baseCustomization()} update={vi.fn()} />);
    expect(screen.getByText('Off')).toBeTruthy();
    openManaPhilosophy();
    expect(screen.queryByLabelText('Color fixing priority')).toBeNull();
    const checkbox = screen.getByLabelText('Blend land priorities') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it('turning the toggle on sets a real equal blend, never undefined', () => {
    const update = vi.fn();
    render(<DeckCustomizer customization={baseCustomization()} update={update} />);
    openManaPhilosophy();
    fireEvent.click(screen.getByLabelText('Blend land priorities'));
    expect(update).toHaveBeenCalledWith({
      manaPhilosophy: { reliable: 0, greedy: 0, spelllands: 0, budget: 0 },
    });
  });

  it('turning the toggle back off returns to unset (undefined), not a fake all-equal blend', () => {
    const update = vi.fn();
    render(
      <DeckCustomizer
        customization={baseCustomization({
          manaPhilosophy: { reliable: 20, greedy: 0, spelllands: 0, budget: 0 },
        })}
        update={update}
      />
    );
    openManaPhilosophy();
    const checkbox = screen.getByLabelText('Blend land priorities') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(update).toHaveBeenCalledWith({ manaPhilosophy: undefined });
  });

  it('Reset all also turns the wheel back off', () => {
    const update = vi.fn();
    render(
      <DeckCustomizer
        customization={baseCustomization({
          manaPhilosophy: { reliable: 20, greedy: 4, spelllands: 0, budget: 0 },
        })}
        update={update}
      />
    );
    fireEvent.click(screen.getByTitle('Reset all customization to defaults'));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ manaPhilosophy: undefined }));
  });

  it('shows all four axes as keyboard-operable native sliders with the live normalized share', () => {
    render(
      <DeckCustomizer
        customization={baseCustomization({
          manaPhilosophy: { reliable: 20, greedy: 0, spelllands: 0, budget: 0 },
        })}
        update={vi.fn()}
      />
    );
    openManaPhilosophy();
    // Native range inputs are fully keyboard/SR operable for free — arrow
    // keys, Home/End, and screen-reader announcement all come from the
    // element itself, matching every other slider in this file (Salt,
    // Staples<->Theme, land count).
    const reliable = screen.getByLabelText('Color fixing priority') as HTMLInputElement;
    expect(reliable.type).toBe('range');
    expect(reliable.value).toBe('20');
    // reliable=20 (max), others=0 raw -> normalize() floors each +0.05 and
    // renormalizes: reliable ~99.3%, the rest split the remainder.
    expect(reliable.getAttribute('aria-valuetext')).toBe('99.3%');
  });

  it('no axis ever displays 0% — the WEIGHT_FLOOR keeps a visible, non-zero share', () => {
    render(
      <DeckCustomizer
        customization={baseCustomization({
          manaPhilosophy: { reliable: 20, greedy: 0, spelllands: 0, budget: 0 },
        })}
        update={vi.fn()}
      />
    );
    openManaPhilosophy();
    const greedy = screen.getByLabelText('Utility priority') as HTMLInputElement;
    // Raw 0 still floors to a non-zero share once normalized — the UI must
    // never claim an axis reads 0% when the engine will never compute one.
    expect(greedy.getAttribute('aria-valuetext')).not.toBe('0%');
    expect(greedy.getAttribute('aria-valuetext')).not.toBe('0.0%');
    expect(greedy.getAttribute('aria-valuetext')).toBe('0.2%');
  });

  it('moving one slider patches only that axis; the others recompute live from the same weights', () => {
    const update = vi.fn();
    const { rerender } = render(
      <DeckCustomizer
        customization={baseCustomization({
          manaPhilosophy: { reliable: 0, greedy: 0, spelllands: 0, budget: 0 },
        })}
        update={update}
      />
    );
    openManaPhilosophy();
    fireEvent.change(screen.getByLabelText('Utility priority'), { target: { value: '20' } });
    expect(update).toHaveBeenCalledWith({
      manaPhilosophy: { reliable: 0, greedy: 20, spelllands: 0, budget: 0 },
    });

    // Re-render with the patched weights (as the real store round-trip
    // would) — the untouched axes' displayed shares must visibly drop,
    // making the redistribution legible without any bespoke sum-preserving
    // slider math.
    rerender(
      <DeckCustomizer
        customization={baseCustomization({
          manaPhilosophy: { reliable: 0, greedy: 20, spelllands: 0, budget: 0 },
        })}
        update={update}
      />
    );
    expect(screen.getByLabelText('Utility priority').getAttribute('aria-valuetext')).toBe('99.3%');
    expect(screen.getByLabelText('Color fixing priority').getAttribute('aria-valuetext')).toBe(
      '0.2%'
    );
  });

  it('collapsed summary reads Equal blend for a true equal engagement, distinct from Off', () => {
    render(
      <DeckCustomizer
        customization={baseCustomization({
          manaPhilosophy: { reliable: 0, greedy: 0, spelllands: 0, budget: 0 },
        })}
        update={vi.fn()}
      />
    );
    expect(screen.getByText('Equal blend')).toBeTruthy();
  });

  it('collapsed summary names the leaning axis for a skewed blend', () => {
    render(
      <DeckCustomizer
        customization={baseCustomization({
          manaPhilosophy: { reliable: 0, greedy: 20, spelllands: 0, budget: 0 },
        })}
        update={vi.fn()}
      />
    );
    expect(screen.getByText('Utility-leaning')).toBeTruthy();
  });
});

describe('DeckCustomizer — Target Bracket (Exhibition expectations)', () => {
  it('shows no bracket-1 helper text for any other bracket', () => {
    render(
      <DeckCustomizer customization={baseCustomization({ targetBracket: 3 })} update={vi.fn()} />
    );
    expect(screen.queryByText(/themed-build intent/)).toBeNull();
  });

  it('explains that Exhibition never reads below Core once bracket 1 is picked', () => {
    render(
      <DeckCustomizer customization={baseCustomization({ targetBracket: 1 })} update={vi.fn()} />
    );
    expect(screen.getByText(/themed-build intent/)).toBeTruthy();
    expect(screen.getByText(/estimate it at Core \(2\) or higher/)).toBeTruthy();
  });
});
