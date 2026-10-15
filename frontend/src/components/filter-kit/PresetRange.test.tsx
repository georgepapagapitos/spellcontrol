// @vitest-environment happy-dom
import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PresetRange, type PresetRangeValue } from './PresetRange';

const PRESETS = [
  { label: 'Under $1', max: 1 },
  { label: '$1–$5', min: 1, max: 5 },
  { label: '$20+', min: 20 },
];
const latest: { current: PresetRangeValue } = { current: {} };

function Harness({ initial = {} }: { initial?: PresetRangeValue }) {
  const [v, setV] = useState(initial);
  return (
    <PresetRange
      value={v}
      onChange={(n) => {
        latest.current = n;
        setV(n);
      }}
      presets={PRESETS}
      ariaLabel="Filter by price"
      valueLabel="Price"
      prefix="$"
      step={0.01}
    />
  );
}
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('PresetRange', () => {
  it('picks a preset, and the same one again clears it', () => {
    render(<Harness />);
    press('$1–$5');
    expect(latest.current).toEqual({ min: 1, max: 5 });
    expect(screen.getByRole('button', { name: '$1–$5' }).getAttribute('aria-pressed')).toBe('true');
    press('$1–$5');
    expect(latest.current).toEqual({});
  });

  it('Custom… reveals named min and max inputs', () => {
    render(<Harness />);
    expect(screen.queryByLabelText('Price, minimum')).toBeNull();
    press('Custom…');
    fireEvent.change(screen.getByLabelText('Price, minimum'), { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText('Price, maximum'), { target: { value: '9' } });
    expect(latest.current).toEqual({ min: 2.5, max: 9 });
    fireEvent.change(screen.getByLabelText('Price, maximum'), { target: { value: '' } });
    expect(latest.current).toEqual({ min: 2.5, max: undefined });
  });

  it('opens Custom… itself when the value matches no preset, and clears it', () => {
    render(<Harness initial={{ min: 3, max: 4 }} />);
    expect(screen.getByRole('button', { name: 'Custom…' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect((screen.getByLabelText('Price, minimum') as HTMLInputElement).value).toBe('3');
    press('Custom…');
    expect(latest.current).toEqual({});
    expect(screen.queryByLabelText('Price, minimum')).toBeNull();
  });

  it('choosing a preset closes the custom inputs', () => {
    render(<Harness />);
    press('Custom…');
    press('Under $1');
    expect(latest.current).toEqual({ min: undefined, max: 1 });
    expect(screen.queryByLabelText('Price, minimum')).toBeNull();
  });
});
