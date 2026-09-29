import './YourDecks.css';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { useDecksStore, type Deck } from '../../store/decks';
import { useCollectionStore } from '../../store/collection';
import { ColorPip } from '../shared/ManaSymbol';
import { useCardThumb } from '@/lib/cards/card-thumbs';
import { deckCoverArt } from '@/lib/deck/deck-cover';
import { formatRelativeTime } from '@/lib/util/format-time';
import { deckDisplayColors } from '@/lib/deck/deck-validation';
import { ColorIdentityBar } from '../shared/ColorIdentityBar';
import { aggregateNewArrivalDecks } from '@/lib/home/home-signals';
import { readArrivalWatchlists } from '@/lib/coach/arrival-watchlist';
import { readHomeShape, rememberHomeShape } from '@/lib/home/home-shape';
import { useAwaitingFirstPull } from '@/lib/sync/use-awaiting-first-pull';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { HomeSectionSearch } from './HomeSectionSearch';
import { ArtBadge } from '@/components/shared/ArtBadge';
import { Surface } from '../shared/Surface';
import { SectionHeader } from '../shared/SectionHeader';
import { SwipeRow } from '@/components/shared/SwipeRow';

const RECENT_LIMIT = 5;
/** home-shape slot: how many tiles the section showed last visit (0 = none). */
const SHAPE_SLOT = 'your-decks';

function DeckTile({ deck, arrivals }: { deck: Deck; arrivals: number }) {
  const commander = deck.commander;
  const direct = deckCoverArt(deck);
  const resolved = useCardThumb(direct ? undefined : commander?.name, 'art_crop');
  const art = direct ?? resolved;
  const colors = deckDisplayColors(deck);
  const format = DECK_FORMAT_CONFIGS[deck.format]?.label ?? deck.format;
  const edited = formatRelativeTime(deck.updatedAt);
  const label = `Open deck: ${deck.name}, ${format}, edited ${edited}`;

  return (
    <Surface
      as="li"
      variant="sleeve"
      className="decks-index-card"
      style={{ ['--deck-color' as string]: deck.color }}
    >
      <Link to={`/decks/${deck.id}`} className="decks-index-card-link" aria-label={label}>
        {art ? (
          <img className="decks-index-card-art" src={art} alt="" aria-hidden="true" />
        ) : commander ? (
          <span className="decks-index-card-art home-tile-art-loading" aria-hidden="true" />
        ) : (
          <span className="decks-index-card-banner" aria-hidden="true">
            {colors.length > 0 && (
              <span className="decks-index-card-banner-pips">
                {colors.map((c) => (
                  <ColorPip key={c} color={c} pip="lg" />
                ))}
              </span>
            )}
          </span>
        )}
        <ColorIdentityBar colors={colors} />
        <div className="decks-index-card-body">
          <div className="decks-index-card-name">
            <span>{deck.name}</span>
          </div>
          {commander && (
            <div className="home-deck-commander">
              {commander.name}
              {deck.partnerCommander ? ` + ${deck.partnerCommander.name}` : ''}
            </div>
          )}
          <div className="decks-index-card-meta">
            <span className="decks-index-card-time">Edited {edited}</span>
            {colors.length > 0 && (
              <span className="decks-index-card-pips home-deck-pips" aria-hidden="true">
                {colors.map((c) => (
                  <ColorPip key={c} color={c} />
                ))}
              </span>
            )}
          </div>
        </div>
      </Link>
      {arrivals > 0 && (
        <Link
          to={`/decks/${deck.id}?arrivals=1`}
          className="home-deck-arrivals-link"
          aria-label={`Review ${arrivals} new card${arrivals === 1 ? '' : 's'} for ${deck.name}`}
        >
          <ArtBadge className="home-deck-arrivals" tone="success">
            <Sparkles width={12} height={12} strokeWidth={2} aria-hidden="true" />+{arrivals} new
            card{arrivals === 1 ? '' : 's'}
          </ArtBadge>
        </Link>
      )}
    </Surface>
  );
}

/**
 * Your decks, the thing people come back to Home for, shown as the same
 * commander-art tiles the decks index uses (§ Index tiles wear cover art) —
 * it was a list of 2.5rem full-card scans with a Commander badge on every
 * row. The five most recently edited, a row that swipes below desktop.
 *
 * A deck with new cards its coach wants carries "+N new cards" on its art,
 * a link to the deck's new-arrivals sheet with those same N cards in it
 * (lib/coach/arrival-watchlist.ts). The count is per deck, never summed.
 *
 * No decks: nothing. The hero's checklist and Waiting on you already invite
 * the first one, so an empty section here would say it a third time.
 */
export function YourDecks() {
  const decks = useDecksStore((s) => s.decks);
  const hydrated = useDecksStore((s) => s.hydrated);
  const awaitingFirstPull = useAwaitingFirstPull();
  const collectionCards = useCollectionStore((s) => s.cards);
  const importHistory = useCollectionStore((s) => s.importHistory);
  const [remembered] = useState(() => readHomeShape()[SHAPE_SLOT]);

  const recent = useMemo(
    () => [...decks].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_LIMIT),
    [decks]
  );
  const [watchlists] = useState(readArrivalWatchlists);
  const arrivals = useMemo(() => {
    const addedAtByImportId = new Map(importHistory.map((e) => [e.id, e.addedAt]));
    return new Map(
      aggregateNewArrivalDecks(decks, collectionCards, addedAtByImportId, watchlists).map((r) => [
        r.deck.id,
        r.count,
      ])
    );
  }, [decks, collectionCards, importHistory, watchlists]);

  // `hydrated` only covers the local IndexedDB read. On a device that has
  // never cached this account that read finds nothing, so without the second
  // clause the section would vanish for someone with nine decks.
  const loading = !hydrated || (decks.length === 0 && awaitingFirstPull);
  useEffect(() => {
    if (!loading) rememberHomeShape(SHAPE_SLOT, recent.length);
  }, [loading, recent.length]);

  if (loading ? remembered === 0 : recent.length === 0) return null;

  return (
    <section className="home-section" aria-labelledby="home-your-decks">
      <SectionHeader
        title="Your decks"
        id="home-your-decks"
        className="home-section-head"
        titleClassName="home-section-title"
        toolsClassName="home-section-tools"
        tools={
          <>
            <HomeSectionSearch
              label="Search your decks"
              toResults={(term) => `/decks?query=${encodeURIComponent(term)}`}
              toPage="/decks"
            />
            <Button
              variant="link"
              to="/decks"
              iconEnd={<ChevronRight width={14} height={14} strokeWidth={1.8} />}
            >
              {loading ? 'All decks' : `All ${decks.length}`}
            </Button>
          </>
        }
      />
      {loading ? (
        <div role="status" aria-label="Loading" aria-busy="true">
          <SwipeRow className="decks-index-list is-grid" aria-hidden="true">
            {Array.from({ length: Math.min(remembered ?? 3, RECENT_LIMIT) || 3 }, (_, i) => (
              <Surface
                as="li"
                variant="sleeve"
                key={i}
                className="decks-index-card home-tile-skeleton"
                aria-hidden="true"
              >
                <span className="home-tile-skeleton-art" />
                <span className="home-tile-skeleton-bar" />
                <span className="home-tile-skeleton-bar" />
              </Surface>
            ))}
          </SwipeRow>
        </div>
      ) : (
        <SwipeRow className="decks-index-list is-grid">
          {recent.map((deck) => (
            <DeckTile key={deck.id} deck={deck} arrivals={arrivals.get(deck.id) ?? 0} />
          ))}
        </SwipeRow>
      )}
    </section>
  );
}
