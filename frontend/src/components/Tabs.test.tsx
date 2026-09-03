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

  it('renders the sliding indicator only for the underline variant, hidden from AT', () => {
    const { container, rerender } = render(
      <Tabs ariaLabel="x" value="a" onChange={() => {}} tabs={TABS} variant="underline" />
    );
    const indicator = container.querySelector('.sc-tab-indicator');
    expect(indicator).toBeTruthy();
    expect(indicator?.getAttribute('aria-hidden')).toBe('true');
    rerender(<Tabs ariaLabel="x" value="a" onChange={() => {}} tabs={TABS} variant="fitted" />);
    expect(container.querySelector('.sc-tab-indicator')).toBeNull();
  });

  it('keeps the indicator hidden when the strip has no measurable layout', () => {
    // happy-dom reports offsetWidth 0 — the indicator must not paint a
    // garbage transform in that case, just stay transparent until the
    // ResizeObserver delivers a real size.
    const { container } = render(
      <Tabs ariaLabel="x" value="a" onChange={() => {}} tabs={TABS} variant="underline" />
    );
    const indicator = container.querySelector<HTMLElement>('.sc-tab-indicator');
    expect(indicator?.style.opacity).toBe('0');
  });
});

// E223 — health badges. The badge's whole point is being readable without
// opening the tab, which means readable to a screen reader too: the glanceable
// text is decorative, the description carries the meaning.
describe('Tabs — scroll strips', () => {
  it('reports no overflow on a strip whose tabs all fit', () => {
    render(
      <Tabs ariaLabel="Strip" value="a" onChange={() => {}} tabs={TABS} variant="underline" />
    );
    expect(screen.getByRole('tablist').getAttribute('data-overflow')).toBe('none');
  });

  it('publishes which edge has more tabs behind it as the strip scrolls', () => {
    render(
      <Tabs ariaLabel="Strip" value="a" onChange={() => {}} tabs={TABS} variant="underline" />
    );
    const list = screen.getByRole('tablist');
    // happy-dom lays nothing out, so fake a strip twice as wide as its box.
    Object.defineProperty(list, 'scrollWidth', { value: 600, configurable: true });
    Object.defineProperty(list, 'clientWidth', { value: 300, configurable: true });
    list.scrollLeft = 0;
    fireEvent.scroll(list);
    expect(list.getAttribute('data-overflow')).toBe('end');
    list.scrollLeft = 150;
    fireEvent.scroll(list);
    expect(list.getAttribute('data-overflow')).toBe('both');
    list.scrollLeft = 300;
    fireEvent.scroll(list);
    expect(list.getAttribute('data-overflow')).toBe('start');
  });

  it('leaves the fitted variant alone — it never scrolls', () => {
    render(<Tabs ariaLabel="Strip" value="a" onChange={() => {}} tabs={TABS} />);
    expect(screen.getByRole('tablist').hasAttribute('data-overflow')).toBe(false);
  });
});

describe('Tabs — health badges', () => {
  const BADGED: Array<TabItem<Id>> = [
    { id: 'a', label: 'Alpha' },
    {
      id: 'b',
      label: 'Beta',
      badge: { text: '3', description: 'deck health: 3 to tune', tone: 'warn' },
    },
    { id: 'c', label: 'Gamma' },
  ];

  it('folds the badge description into the tab’s accessible name', () => {
    render(<Tabs ariaLabel="x" value="a" onChange={() => {}} tabs={BADGED} />);
    const beta = screen.getByRole('tab', { name: /Beta/ });
    expect(beta.textContent).toContain('deck health: 3 to tune');
  });

  it('renders the glanceable text with its tone, hidden from the a11y tree', () => {
    const { container } = render(
      <Tabs ariaLabel="x" value="a" onChange={() => {}} tabs={BADGED} />
    );
    const badge = container.querySelector('.sc-tab-badge');
    expect(badge?.textContent).toBe('3');
    expect(badge?.getAttribute('data-tone')).toBe('warn');
    expect(badge?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders no badge element when a tab has none', () => {
    const { container } = render(<Tabs ariaLabel="x" value="a" onChange={() => {}} tabs={TABS} />);
    expect(container.querySelector('.sc-tab-badge')).toBeNull();
  });
});
