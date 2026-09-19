// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDecksStore, type Deck } from '@/store/decks';
import { savePlaytestSnapshot, type PlaytestSnapshot } from '@/lib/playtest/session-snapshot';
import { PlaytestLogPage } from './PlaytestLogPage';

vi.mock('@/styles/playtest.css', () => ({}));

const deck = { id: 'd1', name: 'Krenko', updatedAt: 5, cards: [] } as unknown as Deck;

function snap(text: string): PlaytestSnapshot {
  return {
    fingerprint: '5:0',
    savedAt: 1,
    state: {
      zones: { hand: [], library: [], graveyard: [], exile: [], command: [] },
      battlefield: [],
      rngSeed: 1,
      turn: 1,
    } as unknown as PlaytestSnapshot['state'],
    phase: 'playing',
    mulliganCount: 0,
    gameLog: [{ seq: 1, turn: 1, kind: 'play', text }],
  } as unknown as PlaytestSnapshot;
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/decks/d1/playtest/log']}>
      <Routes>
        <Route path="/decks/:id/playtest/log" element={<PlaytestLogPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  useDecksStore.setState({ decks: [deck], hydrated: true } as never);
});

describe('PlaytestLogPage', () => {
  it('shows the saved session log for the deck and follows it through storage events', () => {
    savePlaytestSnapshot('d1', snap('Sol Ring played from hand'));
    mount();
    expect(screen.getByText('Sol Ring played from hand')).toBeTruthy();
    savePlaytestSnapshot('d1', snap('Krenko played from hand'));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'spellcontrol:playtest:d1' }));
    });
    expect(screen.getByText('Krenko played from hand')).toBeTruthy();
  });

  it('says so when the deck is unknown', () => {
    useDecksStore.setState({ decks: [], hydrated: true } as never);
    mount();
    expect(screen.getByText('Deck not found.')).toBeTruthy();
  });
});
