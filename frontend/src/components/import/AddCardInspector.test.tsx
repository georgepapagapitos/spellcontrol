// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';

const card = (id: string, set: string, num: string): ScryfallCard =>
  ({
    id,
    oracle_id: 'o-dark-ritual',
    name: 'Dark Ritual',
    type_line: 'Instant',
    set,
    set_name: set === 'msc' ? 'Marvel Super Heroes Commander' : 'Masters 25',
    collector_number: num,
    finishes: ['nonfoil'],
    prices: { usd: '1.00' },
    image_uris: { normal: `https://cards.scryfall.io/normal/${id}.jpg` },
  }) as unknown as ScryfallCard;

const ROW = card('msc', 'msc', '793');
const OTHER = card('a25', 'a25', '82');

vi.mock('@/lib/api', () => ({ fetchPrintings: vi.fn(async () => [ROW, OTHER]) }));

import { AddCardInspector } from './AddCardInspector';

// The header showed the row's printing while a different printing tile was
// selected underneath, so the big image misstated what Add would add.
describe('AddCardInspector', () => {
  it('shows the printing the picker will add, following each pick', async () => {
    render(<AddCardInspector card={ROW} onAdd={() => {}} />);
    await act(async () => {});
    expect(screen.getByText('Marvel Super Heroes Commander · MSC #793')).toBeTruthy();

    const a25 = await screen.findByRole('option', { name: /Masters 25|A25 #82/ });
    fireEvent.click(a25);
    expect(screen.getByText('Masters 25 · A25 #82')).toBeTruthy();
    expect(
      screen.getByRole('img', { name: 'Dark Ritual, Masters 25' }).getAttribute('src')
    ).toContain('a25');
  });

  it('shows a quiet empty state with no active card', () => {
    render(<AddCardInspector card={null} onAdd={() => {}} />);
    expect(screen.getByText('Search for a card to see it here.')).toBeTruthy();
  });
});
