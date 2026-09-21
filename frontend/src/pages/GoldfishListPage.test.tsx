// @vitest-environment happy-dom
/**
 * No `@testing-library/jest-dom` in this repo — assertions use plain
 * vitest/chai matchers, not `.toBeInTheDocument()`.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeckImportResponse } from '../types';

const importDeckText = vi.fn<(text: string) => Promise<DeckImportResponse>>();
vi.mock('@/lib/api', () => ({ importDeckText: (t: string) => importDeckText(t) }));

const show = vi.fn();
vi.mock('@/store/toasts', () => ({ toast: { show: (i: unknown) => show(i) } }));

// The board is a whole subsystem with its own store and snapshot machinery;
// this page's job is to get a parsed list TO it, so a stand-in proves the
// handoff without dragging the reducer into a page test.
vi.mock('@/playtest/components/PlaytestSession', () => ({
  PlaytestSession: ({ deck, external }: { deck: { name: string }; external?: boolean }) => (
    <div data-testid="session">
      {deck.name}
      {external ? ' (external)' : ''}
    </div>
  ),
}));

import { GoldfishListPage } from './GoldfishListPage';
import type { ScryfallCard } from '@/deck-builder/types';

/** The page only ever reads a card's name, so the fixture stops at one. */
function card(id: string, name: string): ScryfallCard {
  return { id, name } as ScryfallCard;
}

function parsed(over: Partial<DeckImportResponse> = {}): DeckImportResponse {
  return {
    commander: null,
    companion: null,
    cards: [card('sol-ring', 'Sol Ring'), card('island', 'Island')],
    unresolvedNames: [],
    fetchErrors: [],
    detectedFormat: 'commander',
    cardCount: 2,
    ...over,
  };
}

function setup() {
  return render(
    <MemoryRouter>
      <GoldfishListPage />
    </MemoryRouter>
  );
}

function paste(text: string) {
  fireEvent.change(screen.getByLabelText('The list'), { target: { value: text } });
}

describe('GoldfishListPage', () => {
  beforeEach(() => {
    importDeckText.mockReset();
    show.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it('will not submit an empty box', () => {
    setup();
    expect(
      (screen.getByRole('button', { name: 'Play this list' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('hands the parsed list to the board as an external deck', async () => {
    importDeckText.mockResolvedValue(parsed({ commander: card('a', 'Atraxa') }));
    setup();
    paste('1 Atraxa\n1 Sol Ring');
    fireEvent.click(screen.getByRole('button', { name: 'Play this list' }));
    await waitFor(() => expect(screen.getByTestId('session')).toBeTruthy());
    expect(screen.getByTestId('session').textContent).toBe('Atraxa (external)');
  });

  it('says what it could not read instead of dealing a short deck', async () => {
    importDeckText.mockResolvedValue(parsed({ unresolvedNames: ['Blakc Lotus'] }));
    setup();
    paste('1 Sol Ring\n1 Blakc Lotus');
    fireEvent.click(screen.getByRole('button', { name: 'Play this list' }));
    await waitFor(() => expect(show).toHaveBeenCalled());
    expect(show.mock.calls[0][0]).toMatchObject({ tone: 'warn' });
  });

  it('rejects text that did not read as a decklist', async () => {
    importDeckText.mockResolvedValue(parsed({ cards: [], cardCount: 0 }));
    setup();
    paste('hello there');
    fireEvent.click(screen.getByRole('button', { name: 'Play this list' }));
    expect((await screen.findByRole('alert')).textContent).toContain("didn't read as a decklist");
    expect(screen.queryByTestId('session')).toBe(null);
  });

  it('surfaces a failed parse and leaves the text to try again', async () => {
    importDeckText.mockRejectedValue(new Error('offline'));
    setup();
    paste('1 Sol Ring\n1 Island');
    fireEvent.click(screen.getByRole('button', { name: 'Play this list' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((screen.getByLabelText('The list') as HTMLTextAreaElement).value).toBe(
      '1 Sol Ring\n1 Island'
    );
  });
});
