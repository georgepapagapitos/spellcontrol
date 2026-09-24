import './YourDecks.css';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Sparkles } from 'lucide-react';
import { useDecksStore, type Deck } from '../../store/decks';
import { useCollectionStore } from '../../store/collection';
import { ColorPip } from '../shared/ManaSymbol';
import { imageFromCard, useCardThumb } from '../../lib/card-thumbs';
import { formatRelativeTime } from '../../lib/format-time';
import { effectiveDeckColors } from '../../lib/deck-validation';
import { aggregateNewArrivalDecks } from '../../lib/home-signals';
import { readHomeShape, rememberHomeShape } from '../../lib/home-shape';
import { useAwaitingFirstPull } from '../../lib/use-awaiting-first-pull';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { HomeSectionSearch } from './HomeSectionSearch';

const RECENT_LIMIT = 5;
const WUBRG = ['W', 'U', 'B', 'R', 'G'];
/** home-shape slot: how many tiles the section showed last visit (0 = none). */
const SHAPE_SLOT = 'your-decks';

function DeckTile({ deck, arrivals }: { deck: Deck; arrivals: number }) {
  const commander = deck.commander;
  const direct = commander ? imageFromCard(commander, 'art_crop') : undefined;
  const resolved = useCardThumb(direct ? undefined : commander?.name, 'art_crop');
  const art = direct ?? resolved;
  const colors = [...effectiveDeckColors(deck)].sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b));
  const format = DECK_FORMAT_CONFIGS[deck.format]?.label ?? deck.format;
  const edited = formatRelativeTime(deck.updatedAt);
  const label = [
    `Open deck: ${deck.name}`,
    format,
    `edited ${edited}`,
    arrivals > 0 ? `${arrivals} new card${arrivals === 1 ? '' : 's'} that fit` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <li className="decks-index-card" style={{ ['--deck-color' as string]: deck.color }}>
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
        {arrivals > 0 && (
          <span className="home-deck-arrivals" aria-hidden="true">
            <Sparkles width={12} height={12} strokeWidth={2} />+{arrivals} new card
            {arrivals === 1 ? '' : 's'}
          </span>
        )}
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
    </li>
  );
}

/**
 * Your decks, the thing people come back to Home for, shown as the same
 * commander-art tiles the decks index uses (§ Index tiles wear cover art) —
 * it was a list of 2.5rem full-card scans with a Commander badge on every
 * row. The five most recently edited, a row that swipes below desktop.
 *
 * A deck with cards you added since you last edited it carries "+N new
 * cards" on its art. That count used to be summed across decks into one
 * figure in a separate card; it belongs to the deck.
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
  const arrivals = useMemo(() => {
    const addedAtByImportId = new Map(importHistory.map((e) => [e.id, e.addedAt]));
    return new Map(
      aggregateNewArrivalDecks(decks, collectionCards, addedAtByImportId).map((r) => [
        r.deck.id,
        r.count,
      ])
    );
  }, [decks, collectionCards, importHistory]);

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
      <div className="home-section-head">
        <h2 id="home-your-decks" className="home-section-title">
          Your decks
        </h2>
        <div className="home-section-tools">
          <HomeSectionSearch
            label="Search your decks"
            toResults={(term) => `/decks?query=${encodeURIComponent(term)}`}
            toPage="/decks"
          />
          <Link to="/decks" className="home-door">
            {loading ? 'All decks' : `All ${decks.length}`}
            <ChevronRight width={14} height={14} strokeWidth={2} aria-hidden />
          </Link>
        </div>
      </div>
      {loading ? (
        <div role="status" aria-label="Loading" aria-busy="true">
          <ul className="decks-index-list is-grid home-rail" aria-hidden="true">
            {Array.from({ length: Math.min(remembered ?? 3, RECENT_LIMIT) || 3 }, (_, i) => (
              <li key={i} className="decks-index-card home-tile-skeleton" aria-hidden="true">
                <span className="home-tile-skeleton-art" />
                <span className="home-tile-skeleton-bar" />
                <span className="home-tile-skeleton-bar" />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ul className="decks-index-list is-grid home-rail">
          {recent.map((deck) => (
            <DeckTile key={deck.id} deck={deck} arrivals={arrivals.get(deck.id) ?? 0} />
          ))}
        </ul>
      )}
    </section>
  );
}
