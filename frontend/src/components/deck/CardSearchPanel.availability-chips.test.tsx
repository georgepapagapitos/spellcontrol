// @vitest-environment happy-dom
/**
 * The add-cards availability chips narrow the suggestions; they don't start
 * on. They used to be four show-toggles that all began pressed, so the
 * unfiltered list painted four accent fills at rest (2026-10-15 audit,
 * ui-tells.md "pending styled the same as active"). STYLE_GUIDE § Chips: a
 * filter chip is outline at rest and takes the accent only when selected.
 */
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CardSearchPanel } from './CardSearchPanel';
import type { GapAnalysisCard } from '@/deck-builder/types';

vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('@/lib/api', () => ({ useSetMap: () => ({}) }));
vi.mock('@/lib/discover/aggregates-client', () => ({
  getCommanderStats: () => Promise.resolve(null),
}));

const suggestion = (name: string) =>
  ({ name, role: 'ramp', roleLabel: 'Ramp', inclusion: 60 }) as GapAnalysisCard;
const OWNERSHIP: Record<string, 'owned' | 'unowned'> = {
  'Sol Ring': 'owned',
  Cultivate: 'unowned',
};

function renderPanel() {
  render(
    <CardSearchPanel
      deckId="deck-1"
      commanderColorIdentity={[]}
      existingCardCounts={new Map()}
      atCopyLimit={() => false}
      onAdd={vi.fn()}
      enableSuggestions
      suggestions={[suggestion('Sol Ring'), suggestion('Cultivate')]}
      ownershipFor={(name: string) => OWNERSHIP[name] ?? 'unowned'}
    />
  );
}

const chips = () =>
  within(screen.getByRole('group', { name: 'Filter by availability' })).getAllByRole('button');
const chip = (name: RegExp) =>
  within(screen.getByRole('group', { name: 'Filter by availability' })).getByRole('button', {
    name,
  });

describe('add-cards availability chips', () => {
  it('rest unpressed while the full list shows', () => {
    renderPanel();
    expect(chips()).toHaveLength(4);
    for (const c of chips()) expect(c.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Add Sol Ring' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Cultivate' })).toBeTruthy();
  });

  it('pressing one narrows the list to its bucket, and releasing it restores the list', () => {
    renderPanel();
    fireEvent.click(chip(/^Available/));
    expect(chip(/^Available/).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Add Sol Ring' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add Cultivate' })).toBeNull();

    fireEvent.click(chip(/^Unowned/));
    expect(screen.getByRole('button', { name: 'Add Cultivate' })).toBeTruthy();

    fireEvent.click(chip(/^Available/));
    fireEvent.click(chip(/^Unowned/));
    for (const c of chips()) expect(c.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Add Sol Ring' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Cultivate' })).toBeTruthy();
  });
});
