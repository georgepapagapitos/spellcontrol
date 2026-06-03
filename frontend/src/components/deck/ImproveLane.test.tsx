// @vitest-environment happy-dom
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ImproveLane } from './ImproveLane';
import type { GapAnalysisCard } from '@/deck-builder/types';
import type { OptimizeSwaps } from '@/deck-builder/services/deckBuilder/deckAnalyzer';
import type { SynergySuggestion } from '@/deck-builder/services/synergy/suggest';
import type { SubstituteRow } from '@/deck-builder/services/deckBuilder/substituteFinder';
import type { ChangeOwnership } from '@/lib/deck-change';

const gaps: GapAnalysisCard[] = [
  {
    name: 'Cultivate',
    price: '$1.50',
    inclusion: 62,
    synergy: 0.3,
    typeLine: 'Sorcery',
    cmc: 3,
    role: 'ramp',
    roleLabel: 'Ramp',
    imageUrl: '',
  },
  {
    name: 'Farseek',
    price: '$2.00',
    inclusion: 40,
    synergy: 0.2,
    typeLine: 'Sorcery',
    cmc: 2,
    role: 'ramp',
    roleLabel: 'Ramp',
    imageUrl: '',
  },
];

const synergy: SynergySuggestion[] = [
  {
    cardName: 'Intangible Virtue',
    axis: 'tokens',
    axisLabel: 'Tokens / go-wide',
    side: 'payoff',
    reason: 'anthem for tokens',
    inclusion: 12,
  },
];

const optimize: OptimizeSwaps = {
  additions: [],
  removals: [
    {
      name: 'Sol Ring',
      reason: 'Excess Ramp',
      reasonCategory: 'Ramp',
      inclusion: 90,
      role: 'ramp',
      roleLabel: 'Ramp',
    },
  ],
};

const substitutes: SubstituteRow[] = [
  {
    wantedName: 'Cyclonic Rift',
    wantedRole: 'boardwipe',
    wantedRoleLabel: 'Board Wipes',
    usedName: 'Evacuation',
    usedSubtypeMatch: true,
    reason: 'Evacuation fills the board-wipe slot — owned, same bounce',
  },
];

/** Only Cultivate + the owned substitute are "owned"; everything else unowned. */
const resolveOwnership = (name: string): ChangeOwnership =>
  name === 'Cultivate' || name === 'Evacuation' ? 'owned' : 'unowned';

function renderLane(overrides: Partial<Parameters<typeof ImproveLane>[0]> = {}) {
  const onAdd = vi.fn();
  const onCut = vi.fn();
  render(
    <ImproveLane
      gaps={gaps}
      optimize={optimize}
      synergy={synergy}
      substitutes={substitutes}
      resolveOwnership={resolveOwnership}
      onAdd={onAdd}
      onCut={onCut}
      browser={<div>EDHREC browser</div>}
      {...overrides}
    />
  );
  return { onAdd, onCut };
}

describe('ImproveLane', () => {
  // The Owned-only toggle persists to localStorage; reset it so each test
  // starts from the default (off) regardless of run order.
  beforeEach(() => {
    try {
      window.localStorage.clear();
    } catch {
      /* no-op */
    }
  });

  it('merges every prescriptive add-source into one list, owned-first', () => {
    renderLane();
    const list = screen.getAllByRole('list')[0];
    const names = within(list)
      .getAllByText(/Cultivate|Farseek|Intangible Virtue/)
      .map((el) => el.textContent);
    // Cultivate (owned) sorts ahead of the unowned candidates.
    expect(names[0]).toBe('Cultivate');
    expect(names).toContain('Farseek');
    expect(names).toContain('Intangible Virtue');
  });

  it('Owned only filters to owned candidates and injects owned substitutes', () => {
    renderLane();
    fireEvent.click(screen.getByRole('button', { name: 'Owned only' }));
    // Owned add survives, unowned drops, and the owned substitute appears.
    expect(screen.getByText('Cultivate')).toBeTruthy();
    expect(screen.queryByText('Farseek')).toBeNull();
    expect(screen.getByText('Evacuation')).toBeTruthy();
  });

  it('shows optimizer removals under "Consider cutting" and cuts on click', () => {
    const { onCut } = renderLane();
    const cutSummary = screen.getByText(/Consider cutting/);
    fireEvent.click(cutSummary);
    fireEvent.click(screen.getByRole('button', { name: 'Cut Sol Ring' }));
    expect(onCut).toHaveBeenCalledWith('Sol Ring');
  });

  it('adds a card via its row action', () => {
    const { onAdd } = renderLane();
    fireEvent.click(screen.getByRole('button', { name: 'Add Cultivate' }));
    expect(onAdd).toHaveBeenCalledWith('Cultivate');
  });

  it('exposes the EDHREC browser behind an expander', () => {
    renderLane();
    expect(screen.getByText('Browse all EDHREC suggestions')).toBeTruthy();
    expect(screen.getByText('EDHREC browser')).toBeTruthy();
  });

  it('shows an empty hint when Owned only has no matches', () => {
    renderLane({ substitutes: [], gaps: [gaps[1]] }); // only unowned Farseek
    fireEvent.click(screen.getByRole('button', { name: 'Owned only' }));
    expect(screen.getByText(/No owned improvements/)).toBeTruthy();
  });
});
