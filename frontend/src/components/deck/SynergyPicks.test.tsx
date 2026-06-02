// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SynergyPicks } from './SynergyPicks';
import type { SynergySuggestion } from '@/deck-builder/services/synergy/suggest';

const suggestions: SynergySuggestion[] = [
  {
    cardName: 'Cathars’ Crusade',
    axis: 'tokens',
    axisLabel: 'Tokens / go-wide',
    side: 'payoff',
    reason: 'rewards going wide',
    inclusion: 12,
  },
  {
    cardName: 'Intangible Virtue',
    axis: 'tokens',
    axisLabel: 'Tokens / go-wide',
    side: 'payoff',
    reason: 'anthem for tokens',
    inclusion: undefined,
  },
  {
    cardName: 'Blade Historian',
    axis: 'vehicles',
    axisLabel: 'Vehicles',
    side: 'producer',
    reason: 'crews well',
    inclusion: 5,
  },
];

describe('SynergyPicks', () => {
  it('renders each pick grouped under its axis label', () => {
    render(<SynergyPicks suggestions={suggestions} onAdd={vi.fn()} />);
    expect(screen.getByText('Tokens / go-wide')).toBeTruthy();
    expect(screen.getByText('Vehicles')).toBeTruthy();
    expect(screen.getByText('Cathars’ Crusade')).toBeTruthy();
    expect(screen.getByText('Blade Historian')).toBeTruthy();
  });

  it('flags owned picks live from ownedNames and leaves the rest unmarked', () => {
    render(
      <SynergyPicks
        suggestions={suggestions}
        onAdd={vi.fn()}
        ownedNames={new Set(['Blade Historian'])}
      />
    );
    expect(screen.getAllByText('Owned')).toHaveLength(1);
  });

  it('renders "Off-meta" for a pick with no inclusion', () => {
    render(<SynergyPicks suggestions={[suggestions[1]]} onAdd={vi.fn()} />);
    expect(screen.getByText('Off-meta')).toBeTruthy();
  });

  it('fires onAdd with the card name from the row action', () => {
    const onAdd = vi.fn();
    const { container } = render(<SynergyPicks suggestions={[suggestions[0]]} onAdd={onAdd} />);
    fireEvent.click(container.querySelector('.deck-card-row-act') as HTMLButtonElement);
    expect(onAdd).toHaveBeenCalledWith('Cathars’ Crusade');
  });

  it('disables the Add button for names being added', () => {
    const { container } = render(
      <SynergyPicks
        suggestions={[suggestions[0]]}
        onAdd={vi.fn()}
        addingNames={new Set(['Cathars’ Crusade'])}
      />
    );
    expect((container.querySelector('.deck-card-row-act') as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('renders nothing when there are no suggestions', () => {
    const { container } = render(<SynergyPicks suggestions={[]} onAdd={vi.fn()} />);
    expect(container.querySelector('.synergy-picks')).toBeNull();
  });
});
