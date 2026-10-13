// @vitest-environment happy-dom
/**
 * The suggestions filter is a view over the list, not a search: whatever it
 * matched (one card, none), the handoff to a real search stays under it, and
 * the typed text carries into the tab it opens.
 */
import 'fake-indexeddb/auto';
import { fireEvent, render, screen } from '@testing-library/react';
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
      ownershipFor={() => 'owned'}
    />
  );
}

const filterBox = () => screen.getByLabelText('Filter suggestions');
const type = (q: string) => fireEvent.change(filterBox(), { target: { value: q } });

describe('CardSearchPanel: suggestions filter handoff', () => {
  it('shows no handoff while the filter is empty', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: 'Add Sol Ring' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Search all of Scryfall' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Search your collection' })).toBeNull();
  });

  it('keeps the handoff under a partial match', () => {
    renderPanel();
    type('Sol');
    expect(screen.getByRole('button', { name: 'Add Sol Ring' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add Cultivate' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Search your collection' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Search all of Scryfall' })).toBeTruthy();
  });

  it('still offers it on a zero-match filter', () => {
    renderPanel();
    type('zzz');
    expect(screen.getByText('No suggestions match your filter.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Search all of Scryfall' })).toBeTruthy();
  });

  it('carries the typed text into the collection tab', () => {
    renderPanel();
    type('Sol');
    fireEvent.click(screen.getByRole('button', { name: 'Search your collection' }));
    expect((screen.getByLabelText('Search your collection') as HTMLInputElement).value).toBe('Sol');
  });

  it('carries the typed text into the Scryfall tab', () => {
    renderPanel();
    type('Sol');
    fireEvent.click(screen.getByRole('button', { name: 'Search all of Scryfall' }));
    expect((screen.getByLabelText('Search Scryfall') as HTMLInputElement).value).toBe('Sol');
  });
});
