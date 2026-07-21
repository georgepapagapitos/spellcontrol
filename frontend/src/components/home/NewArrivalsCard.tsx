import './NewArrivalsCard.css';
import { useMemo } from 'react';
import { PackagePlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDecksStore } from '../../store/decks';
import { useCollectionStore } from '../../store/collection';
import { aggregateNewArrivalDecks } from '../../lib/home-signals';
import { HomeCard } from './HomeCard';

const DISPLAY_LIMIT = 3;

/**
 * Home's new-arrivals summary — decks whose owned-but-unplayed pool gained
 * qualifying cards since the deck was last touched, collapsed to per-deck
 * counts. Same eligibility guards as the deck-editor "✦ N new" sheet
 * (home-signals.ts's `aggregateNewArrivalDecks`); the user opens the real
 * per-deck review sheet from the deck itself — no deep-link plumbing here.
 */
export function NewArrivalsCard() {
  const decks = useDecksStore((s) => s.decks);
  const collectionCards = useCollectionStore((s) => s.cards);
  const importHistory = useCollectionStore((s) => s.importHistory);

  const addedAtByImportId = useMemo(
    () => new Map(importHistory.map((e) => [e.id, e.addedAt])),
    [importHistory]
  );

  const rows = useMemo(
    () => aggregateNewArrivalDecks(decks, collectionCards, addedAtByImportId),
    [decks, collectionCards, addedAtByImportId]
  );

  const visible = rows.slice(0, DISPLAY_LIMIT);
  const empty = rows.length === 0;

  return (
    <HomeCard
      title="New arrivals"
      icon={PackagePlus}
      loading={false}
      empty={empty}
      emptyText="No new arrivals to review."
      viewAllHref={rows.length > DISPLAY_LIMIT ? '/decks' : undefined}
    >
      <ul className="home-new-arrivals-list">
        {visible.map(({ deck, count }) => (
          <li key={deck.id}>
            <Link
              to={`/decks/${deck.id}`}
              className="home-new-arrival-row"
              aria-label={`Open deck: ${deck.name}, ${count} new arrival${count === 1 ? '' : 's'}`}
            >
              <span className="home-new-arrival-name">{deck.name}</span>
              <span className="home-new-arrival-count">— {count} new</span>
            </Link>
          </li>
        ))}
      </ul>
    </HomeCard>
  );
}
