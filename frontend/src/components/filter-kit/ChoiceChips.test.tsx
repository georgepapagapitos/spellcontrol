// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChoiceChips } from './ChoiceChips';

const OPTIONS = [
  { value: 'rare', label: 'Rare' },
  { value: 'mythic', label: 'Mythic' },
  { value: 'common', label: 'Common' },
];

describe('ChoiceChips, multiple', () => {
  it('shows picked values as pressed and toggles on and off', () => {
    const onChange = vi.fn();
    render(
      <ChoiceChips
        multiple
        ariaLabel="Filter by rarity"
        options={OPTIONS}
        value={['rare']}
        onChange={onChange}
      />
    );
    expect(screen.getByRole('group', { name: 'Filter by rarity' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rare' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Mythic' }).getAttribute('aria-pressed')).toBe(
      'false'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mythic' }));
    expect(onChange).toHaveBeenLastCalledWith(['rare', 'mythic']);
    fireEvent.click(screen.getByRole('button', { name: 'Rare' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe('ChoiceChips, single', () => {
  it('is real radios, with Any first as the reset', () => {
    const onChange = vi.fn();
    render(
      <ChoiceChips
        ariaLabel="Budget"
        anyLabel="Any"
        options={OPTIONS}
        value=""
        onChange={onChange}
      />
    );
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => r.type)).toEqual(['radio', 'radio', 'radio', 'radio']);
    expect(radios[0].checked).toBe(true);
    expect(screen.getByRole('group', { name: 'Budget' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Mythic' }));
    expect(onChange).toHaveBeenLastCalledWith('mythic');
  });

  it('picking Any reports the empty value', () => {
    const onChange = vi.fn();
    render(
      <ChoiceChips
        ariaLabel="Budget"
        anyLabel="Any"
        options={OPTIONS}
        value="rare"
        onChange={onChange}
      />
    );
    expect((screen.getByRole('radio', { name: 'Rare' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Any' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('has no Any option unless asked', () => {
    render(<ChoiceChips ariaLabel="Budget" options={OPTIONS} value="" onChange={() => {}} />);
    expect(screen.queryByRole('radio', { name: 'Any' })).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });
});
