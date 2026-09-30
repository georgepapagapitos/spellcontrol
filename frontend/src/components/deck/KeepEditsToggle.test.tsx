// @vitest-environment happy-dom
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KeepEditsToggle } from './KeepEditsToggle';

const edits = {
  added: ['Skullclamp', 'Impact Tremors', 'Goblin Bombardment'],
  cut: ['Sol Ring', 'Arcane Signet'],
};

describe('KeepEditsToggle', () => {
  it('is a checkbox named by its counts, checked by default', () => {
    render(<KeepEditsToggle edits={edits} checked onChange={() => {}} />);
    const box = screen.getByRole('checkbox', {
      name: 'Keep my edits (3 added, 2 cut)',
    }) as HTMLInputElement;
    expect(box.checked).toBe(true);
  });

  it('reports the new state and says what an unchecked rebuild does', () => {
    const onChange = vi.fn();
    function Harness() {
      const [on, setOn] = useState(true);
      return (
        <KeepEditsToggle
          edits={edits}
          checked={on}
          onChange={(v) => {
            onChange(v);
            setOn(v);
          }}
        />
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(false);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText('Rebuilds from the original settings.')).not.toBeNull();
  });
});
