// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BinderStartChooser } from './BinderStartChooser';
import type { EnrichedCard } from '../types';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const setEditingBinder = vi.fn();
vi.mock('../store/collection', () => ({
  useCollectionStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ setEditingBinder }),
}));

function card(name: string): EnrichedCard {
  return {
    copyId: name,
    scryfallId: `sf-${name}`,
    name,
    typeLine: 'Creature',
    colorIdentity: ['G'],
    rarity: 'common',
    purchasePrice: 1,
    setCode: 'tst',
    setName: 'Test',
    collectorNumber: '1',
  } as unknown as EnrichedCard;
}

describe('BinderStartChooser — the "Plan a shelf" lead tile (E496)', () => {
  it('shows the lead tile when the collection has cards', () => {
    render(<BinderStartChooser cards={[card('a'), card('b')]} onPick={() => {}} />);
    expect(screen.getByText('Organize my whole collection')).toBeTruthy();
  });

  it('hides the lead tile for an empty collection', () => {
    render(<BinderStartChooser cards={[]} onPick={() => {}} />);
    expect(screen.queryByText('Organize my whole collection')).toBeFalsy();
  });

  it('closes the editor and hands off to the binders index planner on click', () => {
    render(<BinderStartChooser cards={[card('a'), card('b'), card('c')]} onPick={() => {}} />);
    fireEvent.click(screen.getByText('Organize my whole collection'));
    expect(setEditingBinder).toHaveBeenCalledWith(null);
    expect(navigateMock).toHaveBeenCalledWith('/collection/binders?planShelf=1');
  });

  it('does not affect the existing template tiles', () => {
    render(<BinderStartChooser cards={[card('a')]} onPick={() => {}} />);
    expect(screen.getByText('Blank')).toBeTruthy();
    expect(screen.getByText('From a list')).toBeTruthy();
  });
});
