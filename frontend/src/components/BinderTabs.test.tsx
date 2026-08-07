// @vitest-environment happy-dom
/**
 * E206 — BinderTabs a11y. The strip hand-rolls its own tab markup (E164:
 * per-tab reorder/edit/delete has no slot on the shared `Tabs` primitive),
 * so it needs its own coverage of the same contract `Tabs.test.tsx` checks:
 * role=tablist/tab/aria-selected, roving tabindex, and arrow/Home/End nav —
 * scoped to just the real binder tabs, not the trailing toolbar buttons.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BinderTabs } from './BinderTabs';
import type { MaterializedBinder } from '../types';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

let activeTab = 'a';
const setActiveTab = vi.fn((id: string) => {
  activeTab = id;
});
const setEditingBinder = vi.fn();
const moveBinder = vi.fn();
const deleteBinder = vi.fn();
const deleteAllBinders = vi.fn();

vi.mock('../store/collection', () => ({
  useCollectionStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      activeTab,
      setActiveTab,
      setEditingBinder,
      moveBinder,
      deleteBinder,
      deleteAllBinders,
    }),
}));

function fakeBinder(id: string, name: string, position: number): MaterializedBinder {
  return {
    def: { id, name, position, color: '#4488ff' } as MaterializedBinder['def'],
    totalCards: position * 10,
  } as MaterializedBinder;
}

const BINDERS = [
  fakeBinder('a', 'Alpha', 0),
  fakeBinder('b', 'Beta', 1),
  fakeBinder('c', 'Gamma', 2),
];

function renderTabs(binders = BINDERS) {
  return render(
    <MemoryRouter>
      <BinderTabs binders={binders} />
    </MemoryRouter>
  );
}

describe('BinderTabs — a11y (E206)', () => {
  beforeEach(() => {
    activeTab = 'a';
    navigateMock.mockClear();
    setActiveTab.mockClear();
  });

  it('exposes a tablist with one tab per binder, scoped to just the binders', () => {
    renderTabs();
    const tablist = screen.getByRole('tablist', { name: 'Binders' });
    expect(tablist.getAttribute('aria-orientation')).toBe('horizontal');
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    // The trailing toolbar actions are real buttons but not tabs.
    expect(screen.getByRole('button', { name: /New binder/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy();
  });

  it('marks the active binder selected and the rest not', () => {
    renderTabs();
    expect(screen.getByRole('tab', { name: /Alpha/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /Beta/ }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: /Gamma/ }).getAttribute('aria-selected')).toBe('false');
  });

  it('uses roving tabindex — only the active tab is in the tab order', () => {
    renderTabs();
    expect(screen.getByRole('tab', { name: /Alpha/ }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: /Beta/ }).getAttribute('tabindex')).toBe('-1');
    expect(screen.getByRole('tab', { name: /Gamma/ }).getAttribute('tabindex')).toBe('-1');
  });

  it('selects on click and navigates to the binder route', () => {
    renderTabs();
    fireEvent.click(screen.getByRole('tab', { name: /Beta/ }));
    expect(setActiveTab).toHaveBeenCalledWith('b');
    expect(navigateMock).toHaveBeenCalledWith('/collection/binders/b');
  });

  // Each key handler closes over the tab's fixed sort-order index, not the
  // currently-selected tab, so a single render can exercise every hop —
  // no need to re-render between assertions to simulate the store update.
  it('ArrowRight moves selection to the next tab and wraps at the end', () => {
    renderTabs();
    fireEvent.keyDown(screen.getByRole('tab', { name: /Alpha/ }), { key: 'ArrowRight' });
    expect(setActiveTab).toHaveBeenCalledWith('b');
    fireEvent.keyDown(screen.getByRole('tab', { name: /Gamma/ }), { key: 'ArrowRight' });
    // wraps past the last tab back to the first
    expect(setActiveTab).toHaveBeenCalledWith('a');
  });

  it('ArrowLeft wraps to the last tab; Home/End jump to the ends', () => {
    renderTabs();
    fireEvent.keyDown(screen.getByRole('tab', { name: /Alpha/ }), { key: 'ArrowLeft' });
    expect(setActiveTab).toHaveBeenCalledWith('c');
    fireEvent.keyDown(screen.getByRole('tab', { name: /Gamma/ }), { key: 'Home' });
    expect(setActiveTab).toHaveBeenCalledWith('a');
    fireEvent.keyDown(screen.getByRole('tab', { name: /Beta/ }), { key: 'End' });
    expect(setActiveTab).toHaveBeenCalledWith('c');
  });

  it('does not respond to ArrowUp/ArrowDown — the strip is horizontal-only', () => {
    renderTabs();
    fireEvent.keyDown(screen.getByRole('tab', { name: /Alpha/ }), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('tab', { name: /Alpha/ }), { key: 'ArrowUp' });
    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it('renders the BinderOverflowMenu trigger as a sibling of the tab, not a descendant', () => {
    renderTabs();
    const activeTabButton = screen.getByRole('tab', { name: /Alpha/ });
    const overflowTrigger = screen.getByRole('button', { name: 'Binder actions' });
    // Not nested inside the role="tab" button — an interactive descendant of
    // a tab is unreachable via the roving-tabindex arrow navigation.
    expect(activeTabButton.contains(overflowTrigger)).toBe(false);
    // Only the active binder's tab gets an overflow trigger.
    expect(screen.queryAllByRole('button', { name: 'Binder actions' })).toHaveLength(1);
  });
});
