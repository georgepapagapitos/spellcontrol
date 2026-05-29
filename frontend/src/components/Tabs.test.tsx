// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Tabs, type TabItem } from './Tabs';

type Id = 'a' | 'b' | 'c';
const TABS: Array<TabItem<Id>> = [
  { id: 'a', label: 'Alpha', count: 2 },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma', count: 0 },
];

/** Controlled wrapper so arrow-key selection actually re-renders. */
function Harness({ onChange }: { onChange?: (id: Id) => void }) {
  const [value, setValue] = useState<Id>('a');
  return (
    <Tabs
      ariaLabel="Test tabs"
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange?.(id);
      }}
      tabs={TABS}
    />
  );
}

describe('Tabs', () => {
  it('renders a tablist with one tab per item and marks the active one selected', () => {
    render(<Harness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(screen.getByRole('tab', { name: /Alpha/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /Beta/ }).getAttribute('aria-selected')).toBe('false');
  });

  it('renders a count badge only when count is a number (including 0)', () => {
    render(<Harness />);
    // Alpha → 2, Gamma → 0 both render; Beta (undefined) does not.
    expect(screen.getByRole('tab', { name: /Alpha/ }).textContent).toContain('2');
    expect(screen.getByRole('tab', { name: /Gamma/ }).textContent).toContain('0');
  });

  it('selects on click', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: /Beta/ }));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.getByRole('tab', { name: /Beta/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('uses roving tabindex — only the active tab is in the tab order', () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: /Alpha/ }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: /Beta/ }).getAttribute('tabindex')).toBe('-1');
  });

  it('ArrowRight moves selection to the next tab and wraps at the end', () => {
    render(<Harness />);
    const alpha = screen.getByRole('tab', { name: /Alpha/ });
    fireEvent.keyDown(alpha, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /Beta/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: /Beta/ }), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('tab', { name: /Gamma/ }), { key: 'ArrowRight' });
    // wrapped back to Alpha
    expect(screen.getByRole('tab', { name: /Alpha/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('ArrowLeft wraps to the last tab; Home/End jump to the ends', () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole('tab', { name: /Alpha/ }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: /Gamma/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: /Gamma/ }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: /Alpha/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: /Alpha/ }), { key: 'End' });
    expect(screen.getByRole('tab', { name: /Gamma/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('applies the variant class', () => {
    const { container, rerender } = render(
      <Tabs ariaLabel="x" value="a" onChange={() => {}} tabs={TABS} />
    );
    expect(container.querySelector('.sc-tabs--fitted')).toBeTruthy();
    rerender(<Tabs ariaLabel="x" value="a" onChange={() => {}} tabs={TABS} variant="scrollable" />);
    expect(container.querySelector('.sc-tabs--scrollable')).toBeTruthy();
  });
});
