// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AttackerGroup } from '@/lib/horde';
import { HordeAttackBanner } from './HordeAttackBanner';

const NUMERIC_GROUP: AttackerGroup = { name: 'Zombie', power: '2', toughness: '2', count: 7 };
const VARIABLE_GROUP: AttackerGroup = {
  name: 'Soulless One',
  power: '*',
  toughness: '*',
  count: 1,
};

describe('HordeAttackBanner', () => {
  it('prefills with the full power and Take N sends it', () => {
    const onTake = vi.fn();
    render(<HordeAttackBanner attackers={3} power={14} groups={[NUMERIC_GROUP]} onTake={onTake} />);
    expect(screen.getByDisplayValue('14')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Take 14' }));
    expect(onTake).toHaveBeenCalledWith(14);
  });

  it('accepts a life-sized 3-digit value and clamps to power, never past it, when every attacker is numeric', () => {
    const onTake = vi.fn();
    render(
      <HordeAttackBanner attackers={20} power={40} groups={[NUMERIC_GROUP]} onTake={onTake} />
    );
    const input = screen.getByDisplayValue('40');
    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Take 40' }));
    expect(onTake).toHaveBeenCalledWith(40);
  });

  it('ignores non-digit input and reads Skip at 0', () => {
    const onTake = vi.fn();
    render(<HordeAttackBanner attackers={1} power={5} groups={[NUMERIC_GROUP]} onTake={onTake} />);
    const input = screen.getByDisplayValue('5');
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(screen.getByDisplayValue('5')).toBeTruthy();
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onTake).toHaveBeenCalledWith(0);
  });

  // Soulless One (`*`/`*`) attacking alone: `attackSummary` counts its power
  // as 0, which used to also clamp the field's max to 0 — there was no way
  // to type the damage it really dealt (#2178).
  it('lets a variable-power attacker deal real damage past the (0) printed power', () => {
    const onTake = vi.fn();
    render(<HordeAttackBanner attackers={1} power={0} groups={[VARIABLE_GROUP]} onTake={onTake} />);
    const input = screen.getByDisplayValue('0');
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Take 7' }));
    expect(onTake).toHaveBeenCalledWith(7);
  });

  it('names the variable attackers in the copy, plainly', () => {
    render(
      <HordeAttackBanner
        attackers={2}
        power={2}
        groups={[NUMERIC_GROUP, VARIABLE_GROUP]}
        onTake={vi.fn()}
      />
    );
    expect(screen.getByRole('status').textContent).toContain(
      'The horde attacks: 2 creatures, 2 power, plus 1 with variable power. How much got through?'
    );
  });

  it('says nothing extra when every attacker is numeric', () => {
    render(<HordeAttackBanner attackers={1} power={2} groups={[NUMERIC_GROUP]} onTake={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain(
      'The horde attacks: 1 creature, 2 power. How much got through?'
    );
  });
});
