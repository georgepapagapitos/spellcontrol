// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PodRule0Deck } from '@/lib/social/pods-client';

vi.mock('@/lib/social/pods-client', () => ({
  fetchPodRule0: vi.fn(),
  addPodDeck: vi.fn(() => Promise.resolve()),
  removePodDeck: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/social/publications-client', () => ({
  listMyPublications: vi.fn(() => Promise.resolve([])),
}));
vi.mock('@/lib/social/share-client', () => ({
  listShares: vi.fn(() => Promise.resolve([])),
}));
vi.mock('@/store/decks', () => ({
  useDecksStore: (sel: (s: { decks: unknown[] }) => unknown) =>
    sel({
      decks: [
        { id: 'mine-pub', name: 'Public brew', format: 'commander' },
        { id: 'mine-priv', name: 'Secret brew', format: 'commander' },
        { id: 'mine-60', name: 'Modern thing', format: 'modern' },
      ],
    }),
}));

import { PodRule0Notes } from './PodRule0Notes';
import { addPodDeck, fetchPodRule0, removePodDeck } from '@/lib/social/pods-client';
import { listMyPublications } from '@/lib/social/publications-client';

function row(over: Partial<PodRule0Deck> = {}): PodRule0Deck {
  return {
    userId: 'u2',
    username: 'bo',
    deckId: 'd2',
    name: 'Korvold',
    commanderName: 'Korvold, Fae-Cursed King',
    bracket: 4,
    bracketStated: false,
    estimatedBracket: 4,
    estimateIsFloor: false,
    signals: {
      gameChangers: 3,
      gameChangerNames: ['Rhystic Study'],
      massLandDenial: 0,
      extraTurns: 0,
      twoCardCombos: 1,
      multiCardCombos: 0,
    },
    reach: 'public',
    mine: false,
    ...over,
  };
}

function mount() {
  return render(
    <MemoryRouter>
      <PodRule0Notes podId="p1" />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchPodRule0).mockResolvedValue([]);
});

describe('PodRule0Notes', () => {
  it('shows a loading state, then the empty state with the picker', async () => {
    mount();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    expect(await screen.findByText(/No decks in the notes yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose your decks' })).toBeTruthy();
  });

  it('shows an error with a retry that loads again', async () => {
    vi.mocked(fetchPodRule0).mockRejectedValueOnce(new Error('boom'));
    mount();
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/No decks in the notes yet/)).toBeTruthy();
    expect(fetchPodRule0).toHaveBeenCalledTimes(2);
  });

  it('writes the spread, the signals and a neutral widest-gap note', async () => {
    vi.mocked(fetchPodRule0).mockResolvedValue([
      row(),
      row({
        userId: 'u3',
        username: 'cy',
        deckId: 'd3',
        name: 'Precon',
        commanderName: null,
        bracket: 2,
        estimatedBracket: 2,
        signals: {
          gameChangers: 0,
          gameChangerNames: [],
          massLandDenial: 0,
          extraTurns: 0,
          twoCardCombos: 0,
          multiCardCombos: 0,
        },
      }),
    ]);
    mount();
    expect(await screen.findByText('Brackets 2 to 4; one deck has a two-card combo.')).toBeTruthy();
    expect(
      screen.getByText(/Widest gap: Precon \(cy\) at Bracket 2 and Korvold \(bo\) at Bracket 4/)
    ).toBeTruthy();
    expect(screen.getByText('3 Game Changers')).toBeTruthy();
    expect(screen.getByText('Game Changers: Rhystic Study')).toBeTruthy();
    expect(screen.getByText(/No Game Changers, combos, land denial or extra turns/)).toBeTruthy();
    // Notes, not verdicts.
    expect(document.body.textContent).not.toMatch(/archenemy|should|strongest|weakest/i);
  });

  it('states a stated bracket beside a differing estimate and marks unrated decks', async () => {
    vi.mocked(fetchPodRule0).mockResolvedValue([
      row({ bracket: 2, bracketStated: true, estimatedBracket: 4 }),
      row({ deckId: 'd9', name: 'Fresh', bracket: null, estimatedBracket: null, signals: null }),
    ]);
    mount();
    expect(await screen.findByText('Bracket 2 · est. 4')).toBeTruthy();
    expect(screen.getByText('Not rated yet')).toBeTruthy();
  });

  it('flags your own deck that the pod cannot see, and removes it on request', async () => {
    vi.mocked(fetchPodRule0).mockResolvedValue([
      row({ mine: true, userId: 'me', deckId: 'dm', name: 'Mine', reach: 'private' }),
    ]);
    mount();
    expect(await screen.findByText(/Only you can see this one now/)).toBeTruthy();
    // A deck the pod can't see isn't counted in the spread.
    expect(screen.queryByText(/^All Bracket/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Take Mine out of the notes' }));
    await waitFor(() => expect(removePodDeck).toHaveBeenCalledWith('p1', 'dm'));
  });

  it('lets you add a published deck and blocks a private one with a way forward', async () => {
    vi.mocked(listMyPublications).mockResolvedValue([
      { deckId: 'mine-pub', slug: 's', unpublishedAt: null, viewCount: 0, copyCount: 0 },
    ]);
    mount();
    await screen.findByText(/No decks in the notes yet/);
    fireEvent.click(screen.getByRole('button', { name: 'Choose your decks' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Public brew')).toHaveProperty('disabled', false)
    );
    expect(within(dialog).queryByText('Modern thing')).toBeNull();
    const priv = within(dialog).getByLabelText('Secret brew');
    expect(priv).toHaveProperty('disabled', true);
    expect(within(dialog).getByRole('link', { name: 'Share or publish it' })).toBeTruthy();
    fireEvent.click(within(dialog).getByLabelText('Public brew'));
    await waitFor(() => expect(addPodDeck).toHaveBeenCalledWith('p1', 'mine-pub'));
  });

  it('says so when the server refuses an add', async () => {
    vi.mocked(listMyPublications).mockResolvedValue([
      { deckId: 'mine-pub', slug: 's', unpublishedAt: null, viewCount: 0, copyCount: 0 },
    ]);
    vi.mocked(addPodDeck).mockRejectedValueOnce(new Error('You can put up to 6 decks in a pod.'));
    mount();
    await screen.findByText(/No decks in the notes yet/);
    fireEvent.click(screen.getByRole('button', { name: 'Choose your decks' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Public brew')).toHaveProperty('disabled', false)
    );
    fireEvent.click(within(dialog).getByLabelText('Public brew'));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/up to 6 decks/);
  });
});
