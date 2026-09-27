// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { EnrichedCard } from '../types';
import { CardSlot } from './CardSlot';
import { CardPreviewContext, type CardPreviewCtx } from './CardPreviewContext';
import { OverflowMenu } from './OverflowMenu';

const card = {
  copyId: 'c1',
  name: 'Kroxa, Titan of Death’s Hunger',
  rarity: 'mythic',
  typeLine: 'Legendary Creature',
} as unknown as EnrichedCard;

function renderPocket(cardMenu?: CardPreviewCtx['cardMenu']) {
  const ctx: CardPreviewCtx = {
    openCard: () => {},
    openPages: () => {},
    isPreviewOpen: false,
    cardMenu,
  };
  return render(
    <CardPreviewContext.Provider value={ctx}>
      <CardSlot card={card} />
    </CardPreviewContext.Provider>
  );
}

const menu = () => (
  <OverflowMenu
    className="slot-menu"
    triggerClassName="collection-grid-menu-btn"
    ariaLabel="Actions for Kroxa"
    contextHost=".slot-cell"
    items={[{ label: 'Edit card', onClick: () => {} }]}
  />
);

describe('binder pocket menu (T162)', () => {
  it('puts the ⋮ beside the pocket, never inside its role="button"', () => {
    renderPocket(menu);
    const trigger = screen.getByRole('button', { name: 'Actions for Kroxa' });
    expect(trigger.closest('.slot')).toBeNull();
    expect(trigger.closest('.slot-cell')).not.toBeNull();
  });

  it('opens the same menu on a right-click of the pocket, and marks it', () => {
    renderPocket(menu);
    const pocket = screen.getByRole('button', { name: /Open details for Kroxa/ });
    expect(fireEvent.contextMenu(pocket, { clientX: 10, clientY: 10 })).toBe(false);
    expect(screen.getByRole('menuitem', { name: 'Edit card' })).toBeTruthy();
    expect(pocket.closest('.slot-cell')!.hasAttribute('data-menu-open')).toBe(true);
  });

  it('has no ⋮ and leaves right-click to the browser without a menu to offer', () => {
    renderPocket(undefined);
    const pocket = screen.getByRole('button', { name: /Open details for Kroxa/ });
    expect(screen.queryByRole('button', { name: 'Actions for Kroxa' })).toBeNull();
    expect(fireEvent.contextMenu(pocket)).toBe(true);
  });
});
