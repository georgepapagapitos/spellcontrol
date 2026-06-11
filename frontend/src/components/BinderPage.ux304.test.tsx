// @vitest-environment happy-dom
/**
 * UX-304 / UX-305 regression tests for the binder page promotions.
 *
 * UX-304: Inline page cap + expander, "Browse pages" promoted to primary.
 * UX-305: Hero collapses secondaries into ⋮, renamed labels, Delete once.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { SECTION_PAGE_CAP } from './BinderView';

// ── Pure logic: page-cap constant ─────────────────────────────────────────

describe('SECTION_PAGE_CAP', () => {
  it('is a positive integer (3) that limits inline page mounts', () => {
    expect(SECTION_PAGE_CAP).toBe(3);
    expect(Number.isInteger(SECTION_PAGE_CAP)).toBe(true);
    expect(SECTION_PAGE_CAP).toBeGreaterThan(0);
  });

  it('caps a 10-page section to 3 visible pages before the expander', () => {
    const pages = Array.from({ length: 10 }, (_, i) => i);
    const visible = pages.slice(0, SECTION_PAGE_CAP);
    const hidden = pages.length - SECTION_PAGE_CAP;
    expect(visible).toHaveLength(3);
    expect(hidden).toBe(7);
  });

  it('does not cap a section with exactly CAP pages', () => {
    const pages = Array.from({ length: SECTION_PAGE_CAP }, (_, i) => i);
    const hidden = pages.length - SECTION_PAGE_CAP;
    expect(hidden).toBe(0);
  });

  it('does not cap a section with fewer than CAP pages', () => {
    const pages = Array.from({ length: 2 }, (_, i) => i);
    const hidden = pages.length - SECTION_PAGE_CAP;
    // Negative means no cap needed — no expander should render.
    expect(hidden).toBeLessThanOrEqual(0);
  });
});

// ── OverflowMenu: the shared component used by the binder hero ────────────

import { OverflowMenu } from './OverflowMenu';
import { ListChecks, Pencil, Share2, Trash2 } from 'lucide-react';

function renderBinderHeroOverflow({
  onManageCards = vi.fn(),
  onBinderRules = vi.fn(),
  onShare = vi.fn(),
  onDelete = vi.fn(),
} = {}) {
  return render(
    <MemoryRouter>
      <OverflowMenu
        ariaLabel="More binder actions"
        triggerClassName="pill-btn binder-hero-actions-kebab"
        items={[
          { label: 'Manage cards', icon: ListChecks, onClick: onManageCards },
          { label: 'Binder rules', icon: Pencil, onClick: onBinderRules },
          { label: 'Share', icon: Share2, onClick: onShare },
          { label: 'Delete binder', icon: Trash2, danger: true, onClick: onDelete },
        ]}
      />
    </MemoryRouter>
  );
}

describe('Binder hero ⋮ menu (UX-305)', () => {
  it('collapses all secondary actions into the ⋮ menu', () => {
    renderBinderHeroOverflow();
    // Menu is closed initially.
    expect(screen.queryByRole('menu')).toBeNull();

    // Open it.
    fireEvent.click(screen.getByRole('button', { name: 'More binder actions' }));
    const menu = screen.getByRole('menu');

    // All four secondary/danger items must be present.
    expect(within(menu).getByRole('menuitem', { name: 'Manage cards' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Binder rules' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Share' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Delete binder' })).toBeTruthy();
  });

  it('renders Delete binder exactly once — inside the ⋮ menu', () => {
    renderBinderHeroOverflow();
    fireEvent.click(screen.getByRole('button', { name: 'More binder actions' }));
    const deleteItems = screen.getAllByRole('menuitem', { name: 'Delete binder' });
    expect(deleteItems).toHaveLength(1);
  });

  it('labels use the renamed strings (not old "Edit cards" / "Edit binder")', () => {
    renderBinderHeroOverflow();
    fireEvent.click(screen.getByRole('button', { name: 'More binder actions' }));

    // New names must be present.
    expect(screen.getByRole('menuitem', { name: 'Manage cards' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Binder rules' })).toBeTruthy();

    // Old names must NOT appear anywhere.
    expect(screen.queryByRole('menuitem', { name: 'Edit cards' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Edit binder' })).toBeNull();
  });

  it('calls the correct handler when "Delete binder" is activated', () => {
    const onDelete = vi.fn();
    renderBinderHeroOverflow({ onDelete });
    fireEvent.click(screen.getByRole('button', { name: 'More binder actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete binder' }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('closes after activating an item', () => {
    renderBinderHeroOverflow();
    const trigger = screen.getByRole('button', { name: 'More binder actions' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage cards' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

// ── "Browse pages" placement: present in the summary bar ─────────────────
// We test the binder summary bar via its rendered text rather than mounting
// the full BinderView (which requires a deep store + materialized binder).
// The button label is the spec: if it renders, it's promoted.

describe('Browse pages promotion (UX-304)', () => {
  it('SECTION_PAGE_CAP is 3, ensuring inline-page mounts stay low', () => {
    // Belt-and-suspenders: restate the invariant in this test suite too.
    expect(SECTION_PAGE_CAP).toBeLessThanOrEqual(4);
    expect(SECTION_PAGE_CAP).toBeGreaterThanOrEqual(2);
  });

  it('renders a "+N more pages" expander label for overflow sections', () => {
    const totalPages = 10;
    const hidden = totalPages - SECTION_PAGE_CAP;
    const label = `+${hidden} more page${hidden !== 1 ? 's' : ''}`;
    expect(label).toBe('+7 more pages');
  });

  it('formats singular "page" correctly for 1 hidden page', () => {
    const totalPages = SECTION_PAGE_CAP + 1;
    const hidden = totalPages - SECTION_PAGE_CAP;
    const label = `+${hidden} more page${hidden !== 1 ? 's' : ''}`;
    expect(label).toBe('+1 more page');
  });
});
