// @vitest-environment happy-dom
/**
 * UX-305 regression tests for the binder hero: secondaries collapse into ⋮,
 * renamed labels, Delete once. The UX-304 inline page cap is covered, against
 * the rendered view, in BinderView.page-cap.test.tsx.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

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
