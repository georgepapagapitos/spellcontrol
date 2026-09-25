// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HordeAttackBanner } from './HordeAttackBanner';

describe('HordeAttackBanner', () => {
  it('prefills with the full power and Take N sends it', () => {
    const onTake = vi.fn();
    render(<HordeAttackBanner attackers={3} power={14} onTake={onTake} />);
    expect(screen.getByDisplayValue('14')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Take 14' }));
    expect(onTake).toHaveBeenCalledWith(14);
  });

  it('accepts a life-sized 3-digit value and clamps to power, never past it', () => {
    const onTake = vi.fn();
    render(<HordeAttackBanner attackers={20} power={40} onTake={onTake} />);
    const input = screen.getByDisplayValue('40');
    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Take 40' }));
    expect(onTake).toHaveBeenCalledWith(40);
  });

  it('ignores non-digit input and reads Skip at 0', () => {
    const onTake = vi.fn();
    render(<HordeAttackBanner attackers={1} power={5} onTake={onTake} />);
    const input = screen.getByDisplayValue('5');
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(screen.getByDisplayValue('5')).toBeTruthy();
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onTake).toHaveBeenCalledWith(0);
  });
});
