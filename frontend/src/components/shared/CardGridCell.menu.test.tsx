// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { EnrichedCard } from '../../types';
import { CardGridCell } from './CardGridCell';
import { OverflowMenu } from '../OverflowMenu';

const card = {
  copyId: 'c1',
  name: 'Sol Ring',
  setCode: 'cmm',
  rarity: 'uncommon',
  purchasePrice: 1,
} as unknown as EnrichedCard;

const menu = (
  <OverflowMenu
    className="collection-grid-menu"
    triggerClassName="collection-grid-menu-btn"
    ariaLabel="Actions for Sol Ring"
    contextHost=".collection-grid-cell"
    items={[{ label: 'Edit card', onClick: () => {} }]}
  />
);

describe('CardGridCell menu (T162)', () => {
  it('renders the ⋮ beside the tile, never inside its role="button"', () => {
    const { container } = render(
      <CardGridCell card={card} qty={1} size="1x" onActivate={() => {}} menu={menu} />
    );
    const trigger = screen.getByRole('button', { name: 'Actions for Sol Ring' });
    expect(trigger.closest('[role="button"].collection-grid-item')).toBeNull();
    expect(container.querySelector('.collection-grid-cell.has-menu')).not.toBeNull();
  });

  it('opens the same menu on a right-click of the card', () => {
    render(<CardGridCell card={card} qty={1} size="1x" onActivate={() => {}} menu={menu} />);
    const tile = screen.getByRole('button', { name: /Sol Ring, quantity 1/ });
    expect(fireEvent.contextMenu(tile, { clientX: 30, clientY: 40 })).toBe(false);
    expect(screen.getByRole('menuitem', { name: 'Edit card' })).toBeTruthy();
    expect(tile.closest('.collection-grid-cell')!.hasAttribute('data-menu-open')).toBe(true);
  });

  it('steps the ⋮ aside in select mode but keeps it for a right-click', () => {
    const { container } = render(
      <CardGridCell card={card} qty={1} size="1x" onActivate={() => {}} menu={menu} selectMode />
    );
    // No `has-menu`: collection.css hides the ⋮ while a tap toggles.
    expect(container.querySelector('.has-menu')).toBeNull();
    const tile = screen.getByRole('button', { name: /Sol Ring, quantity 1/ });
    expect(fireEvent.contextMenu(tile, { clientX: 5, clientY: 5 })).toBe(false);
    expect(screen.getByRole('menuitem', { name: 'Edit card' })).toBeTruthy();
  });
});
