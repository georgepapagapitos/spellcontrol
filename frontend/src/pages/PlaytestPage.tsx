import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDecksStore } from '@/store/decks';
import { deckToPlaytestInit } from '@/playtest/lib/deck-to-playtest';
import { usePlaytestStore } from '@/playtest/store';
import { PlaytestBoard } from '@/playtest/components/PlaytestBoard';
import '@/styles/playtest.css';

export function PlaytestPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const decks = useDecksStore((s) => s.decks);
  const hydrated = useDecksStore((s) => s.hydrated);
  const state = usePlaytestStore((s) => s.state);
  const init = usePlaytestStore((s) => s.init);
  const teardown = usePlaytestStore((s) => s.teardown);
  const storeDeckId = usePlaytestStore((s) => s.deckId);

  const deck = id ? decks.find((d) => d.id === id) : undefined;

  useEffect(() => {
    if (!hydrated) return;
    if (!deck) return;
    if (storeDeckId !== deck.id) {
      init(deck.id, deckToPlaytestInit(deck));
    }
  }, [hydrated, deck, storeDeckId, init]);

  useEffect(() => () => teardown(), [teardown]);

  if (!hydrated) {
    return <div className="playtest-loading">Loading deck…</div>;
  }
  if (!deck) {
    return (
      <div className="playtest-missing">
        <p>Deck not found.</p>
        <button type="button" onClick={() => navigate('/decks')}>
          Back to decks
        </button>
      </div>
    );
  }
  if (!state) {
    return <div className="playtest-loading">Shuffling…</div>;
  }

  return (
    <div className="playtest-page">
      <header className="playtest-page__header">
        <button type="button" onClick={() => navigate(`/decks/${deck.id}`)}>
          ← {deck.name}
        </button>
        <h1>Playtest</h1>
      </header>
      <PlaytestBoard state={state} />
    </div>
  );
}
