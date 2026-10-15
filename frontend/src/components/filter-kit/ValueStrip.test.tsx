// @vitest-environment happy-dom
import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ValueStrip } from './ValueStrip';
import {
  EMPTY_VALUE_STRIP,
  isValueStripRange,
  valueStripCount,
  type ValueStripValue,
} from './value-strip';

const latest: { current: ValueStripValue } = { current: EMPTY_VALUE_STRIP };

function Harness({
  initial = EMPTY_VALUE_STRIP,
  top,
}: {
  initial?: ValueStripValue;
  top?: number;
}) {
  const [v, setV] = useState<ValueStripValue>(initial);
  return (
    <ValueStrip
      value={v}
      onChange={(n) => {
        latest.current = n;
        setV(n);
      }}
      ariaLabel="Filter by mana value"
      valueLabel="Mana value"
      top={top}
    />
  );
}

const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const pressed = (name: string) =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed') === 'true';

describe('ValueStrip chips', () => {
  it('toggles values independently', () => {
    render(<Harness />);
    press('2');
    press('3');
    expect(latest.current).toEqual({ values: [2, 3] });
    press('2');
    expect(latest.current).toEqual({ values: [3] });
    expect(screen.queryByRole('group', { name: /Narrow/ })).toBeNull();
  });

  it('opens the second row at 7+, meaning all of 7 and up until narrowed', () => {
    render(<Harness />);
    press('7+');
    expect(latest.current).toEqual({ values: [], atLeast: 7 });
    expect(screen.getByRole('group', { name: 'Narrow mana value 7 and up' })).toBeTruthy();
    press('9');
    expect(latest.current).toEqual({ values: [9] });
    expect(pressed('7+')).toBe(true);
    press('9');
    expect(latest.current).toEqual({ values: [], atLeast: 7 });
  });

  it('13+ is an open end and can combine with exact values', () => {
    render(<Harness />);
    press('7+');
    press('13+');
    expect(latest.current).toEqual({ values: [], atLeast: 13 });
    press('8');
    expect(latest.current).toEqual({ values: [8], atLeast: 13 });
    press('13+');
    expect(latest.current).toEqual({ values: [8] });
  });

  it('closing 7+ drops the high values and keeps the low ones', () => {
    render(<Harness initial={{ values: [2, 9], atLeast: 13 }} />);
    press('7+');
    expect(latest.current).toEqual({ values: [2] });
  });

  it('counts a range as one and each chip as one', () => {
    expect(valueStripCount({ values: [2, 3], atLeast: 7 })).toBe(3);
    expect(valueStripCount({ min: 4 })).toBe(1);
    expect(valueStripCount({})).toBe(0);
    expect(isValueStripRange({ values: [] })).toBe(false);
  });

  it('takes a different top for power and toughness', () => {
    render(<Harness top={5} />);
    expect(screen.queryByRole('button', { name: '6' })).toBeNull();
    press('5+');
    expect(latest.current).toEqual({ values: [], atLeast: 5 });
    expect(screen.getByRole('button', { name: '11+' })).toBeTruthy();
  });
});

describe('ValueStrip Custom…', () => {
  it('opens a comparator and emits an at-least range', () => {
    render(<Harness />);
    press('Custom…');
    expect(latest.current).toEqual({});
    fireEvent.change(screen.getByLabelText('Mana value', { selector: 'input' }), {
      target: { value: '10' },
    });
    expect(latest.current).toEqual({ min: 10 });
  });

  it('writes each operator in its shape', () => {
    render(<Harness initial={{ min: 4 }} />);
    const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement;
    expect(radio('At least').checked).toBe(true);
    fireEvent.click(radio('At most'));
    expect(latest.current).toEqual({ max: 4 });
    fireEvent.click(radio('Exactly'));
    expect(latest.current).toEqual({ min: 4, max: 4 });
    fireEvent.click(radio('Between'));
    expect(latest.current).toEqual({ min: 4, max: undefined });
    expect(radio('Between').checked).toBe(true);
    fireEvent.change(screen.getByLabelText('Mana value, to'), { target: { value: '9' } });
    expect(latest.current).toEqual({ min: 4, max: 9 });
    fireEvent.change(screen.getByLabelText('Mana value, from'), { target: { value: '5' } });
    expect(latest.current).toEqual({ min: 5, max: 9 });
  });

  it('clearing the number clears the value, and a chip leaves Custom…', () => {
    render(<Harness initial={{ min: 4 }} />);
    fireEvent.change(screen.getByLabelText('Mana value', { selector: 'input' }), {
      target: { value: '' },
    });
    expect(latest.current).toEqual({});
    press('Custom…');
    expect(latest.current).toEqual({ values: [] });
    expect(screen.queryByRole('radio', { name: 'Between' })).toBeNull();
  });
});
