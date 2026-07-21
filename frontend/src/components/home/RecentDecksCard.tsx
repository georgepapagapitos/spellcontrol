import './RecentDecksCard.css';
import { Layers } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDecksStore } from '../../store/decks';
import { ManaCost } from '../ManaCost';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import type { DeckFormat } from '@/deck-builder/types';
import { HomeCard } from './HomeCard';

const RECENT_LIMIT = 5;

function formatLabel(format: DeckFormat): string {
  return DECK_FORMAT_CONFIGS[format]?.label ?? format;
}

/**
 * Home's "Recent decks" rail — the 5 most recently edited decks, each one
 * link row to its editor. Reads the already-hydrated decks store; no new
 * fetch, no re-derivation of anything the Decks index doesn't already show.
 */
export function RecentDecksCard() {
  const decks = useDecksStore((s) => s.decks);
  const hydrated = useDecksStore((s) => s.hydrated);

  const recent = [...decks].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_LIMIT);
  const empty = recent.length === 0;

  return (
    <HomeCard
      title="Recent decks"
      icon={Layers}
      loading={!hydrated}
      empty={empty}
      emptyText="No decks yet."
      viewAllHref={empty ? '/decks/new' : '/decks'}
      viewAllLabel={empty ? 'Create a deck' : undefined}
    >
      <ul className="home-recent-decks-list">
        {recent.map((deck) => {
          const label = formatLabel(deck.format);
          return (
            <li key={deck.id}>
              <Link
                to={`/decks/${deck.id}`}
                className="home-recent-deck-row"
                aria-label={`Open deck: ${deck.name}, ${label}`}
              >
                <span className="home-recent-deck-name">{deck.name}</span>
                {deck.commander?.mana_cost && (
                  <ManaCost cost={deck.commander.mana_cost} className="home-recent-deck-cost" />
                )}
                <span className="deck-format-badge home-recent-deck-format">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </HomeCard>
  );
}
