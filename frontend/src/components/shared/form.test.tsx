// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChoiceList, Disclosure, Field, SegmentedControl, SwitchRow } from './form';

describe('SwitchRow', () => {
  it('is one switch named by its label and described by its hint', () => {
    const onChange = vi.fn();
    render(<SwitchRow label="Double-sided" hint="Backs count" checked onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'Double-sided' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(sw.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Backs count'
    );
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('does nothing while disabled', () => {
    const onChange = vi.fn();
    render(<SwitchRow label="Trade" checked={false} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole('switch', { name: 'Trade' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('SegmentedControl and ChoiceList', () => {
  it('are native radio groups that report the picked value with its type', () => {
    const onPockets = vi.fn();
    const onFill = vi.fn();
    render(
      <>
        <SegmentedControl
          ariaLabel="Pockets"
          value={9}
          options={[
            { value: 4, label: '4' },
            { value: 9, label: '9' },
          ]}
          onChange={onPockets}
        />
        <ChoiceList
          ariaLabel="Filling"
          value={false}
          options={[
            { value: false, label: 'New page', hint: 'Every section starts fresh.' },
            { value: 'continuous', label: 'No gaps' },
          ]}
          onChange={onFill}
        />
      </>
    );
    expect(screen.getByRole('radio', { name: '9' })).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('radio', { name: '4' }));
    expect(onPockets).toHaveBeenCalledWith(4);

    expect(screen.getByText('Every section starts fresh.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /No gaps/ }));
    expect(onFill).toHaveBeenCalledWith('continuous');
  });

  it('show a disabled option without letting it be picked', () => {
    const onSeg = vi.fn();
    const onList = vi.fn();
    const opts = [
      { value: 'public', label: 'Public', hint: 'Sign in to publish.', disabled: true },
      { value: 'private', label: 'Private' },
    ];
    render(
      <>
        <SegmentedControl ariaLabel="Seg" value="private" options={opts} onChange={onSeg} />
        <ChoiceList ariaLabel="List" value="private" options={opts} onChange={onList} />
      </>
    );
    const [seg, list] = screen.getAllByRole('radio', { name: /^Public/ });
    for (const radio of [seg, list]) {
      expect(radio).toHaveProperty('disabled', true);
      expect(radio.closest('label')?.classList.contains('is-disabled')).toBe(true);
      fireEvent.click(radio);
    }
    expect(onSeg).not.toHaveBeenCalled();
    expect(onList).not.toHaveBeenCalled();
  });
});

describe('Disclosure', () => {
  it('states its value while closed and shows its settings once open', () => {
    render(
      <Disclosure title="Pages" summary="9-pocket · one side">
        <Field label="Capacity" hint="Grows with its cards.">
          <span>control</span>
        </Field>
      </Disclosure>
    );
    const toggle = screen.getByRole('button', { name: /Pages/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('9-pocket · one side')).toBeTruthy();
    expect(screen.queryByText('Capacity')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByText('9-pocket · one side')).toBeNull();
    expect(screen.getByText('Capacity')).toBeTruthy();
    expect(screen.getByText('Grows with its cards.')).toBeTruthy();
  });
});
