import './RecentDecksCard.css';
import { Layers } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDecksStore, type Deck } from '../../store/decks';
import { ManaCost } from '../ManaCost';
import { ColorPip } from '../shared/ManaSymbol';
import { imageFromCard, useCardThumb } from '../../lib/card-thumbs';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import type { DeckFormat } from '@/deck-builder/types';
import { HomeCard } from './HomeCard';

const RECENT_LIMIT = 5;

function formatLabel(format: DeckFormat): string {
  return DECK_FORMAT_CONFIGS[format]?.label ?? format;
}

/**
 * Commander thumb for a recent-decks row — a direct `image_uris` read first
 * (the deck's own commander object usually already carries art, no network),
 * `useCardThumb` as the CDN fallback (mirrors `DeckIdentityCard`'s identical
 * two-step resolution). No commander at all falls back to the deck's own
 * color + a colorless ColorPip, the same signal `DecksIndexPage`'s banner
 * uses at full size.
 */
function DeckThumb({ deck }: { deck: Deck }) {
  const commander = deck.commander;
  const direct = commander ? imageFromCard(commander, 'normal') : undefined;
  const resolved = useCardThumb(direct ? undefined : commander?.name, 'normal');
  const art = direct ?? resolved;

  if (!commander) {
    return (
      <span
        className="home-thumb home-thumb-banner card-thumb-tilt"
        style={{ ['--deck-color' as string]: deck.color }}
        aria-hidden="true"
      >
        <ColorPip color="C" />
      </span>
    );
  }

  return (
    <span className="home-thumb card-thumb-tilt" aria-hidden="true">
      {art ? <img src={art} alt="" loading="lazy" /> : <span className="home-thumb-skeleton" />}
    </span>
  );
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
                <DeckThumb deck={deck} />
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
