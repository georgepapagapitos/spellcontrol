import './RecentlyAddedCard.css';
import { useMemo } from 'react';
import { PackagePlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDecksStore } from '../../store/decks';
import { useCollectionStore } from '../../store/collection';
import { aggregateNewArrivalDecks } from '../../lib/home-signals';
import { useCardThumb } from '../../lib/card-thumbs';
import { useAnimatedNumber } from '../../lib/use-animated-number';
import { dayKey, formatDayKey } from '../../lib/value-history';
import { HomeCard } from './HomeCard';

const FAN_LIMIT = 5;
const FIT_LIMIT = 3;

function FanThumb({ name, owned }: { name: string; owned?: string }) {
  const art = useCardThumb(owned ? undefined : name, 'normal');
  const src = owned ?? art;
  return (
    <span className="home-thumb home-added-fan-card" aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" /> : <span className="home-thumb-skeleton" />}
    </span>
  );
}

/**
 * The latest import, and where it goes. Replaces the old New arrivals card,
 * whose headline summed each deck's count — a card that fits three decks was
 * counted three times, so "326 new" was never a number of cards. Here the
 * figure is the import's own card count, the fan is cards from that import
 * (the copies you hold, owned art first), and the list names the decks that
 * have new cards that fit. The per-deck number also sits on each deck's tile
 * in Your decks, where it belongs to the deck. No import yet: nothing.
 */
export function RecentlyAddedCard() {
  const decks = useDecksStore((s) => s.decks);
  const decksHydrated = useDecksStore((s) => s.hydrated);
  const collectionCards = useCollectionStore((s) => s.cards);
  const hydrating = useCollectionStore((s) => s.hydrating);
  const importHistory = useCollectionStore((s) => s.importHistory);

  const latest = useMemo(
    () =>
      importHistory.reduce<(typeof importHistory)[number] | null>(
        (best, e) => (!best || e.addedAt > best.addedAt ? e : best),
        null
      ),
    [importHistory]
  );

  const fan = useMemo(() => {
    const out: Array<{ name: string; owned?: string }> = [];
    if (!latest) return out;
    const seen = new Set<string>();
    for (const card of collectionCards) {
      if (out.length >= FAN_LIMIT) break;
      if (card.importId !== latest.id || seen.has(card.name)) continue;
      seen.add(card.name);
      out.push({ name: card.name, owned: card.imageNormal });
    }
    return out;
  }, [collectionCards, latest]);

  const addedAtByImportId = useMemo(
    () => new Map(importHistory.map((e) => [e.id, e.addedAt])),
    [importHistory]
  );
  const fits = useMemo(
    () => aggregateNewArrivalDecks(decks, collectionCards, addedAtByImportId).slice(0, FIT_LIMIT),
    [decks, collectionCards, addedAtByImportId]
  );

  const { display: displayCount } = useAnimatedNumber(latest?.count ?? 0);

  return (
    <HomeCard
      title="Recently added"
      icon={PackagePlus}
      loading={hydrating || !decksHydrated}
      empty={!latest}
      viewAllHref="/collection"
      viewAllLabel="Collection"
      className="home-added-card"
    >
      {latest && (
        <>
          <div className="home-added-head">
            {fan.length > 0 && (
              <span className="home-added-fan">
                {fan.map((c) => (
                  <FanThumb key={c.name} name={c.name} owned={c.owned} />
                ))}
              </span>
            )}
            <p className="home-added-figure">
              <span className="home-added-count">{displayCount.toLocaleString()}</span>{' '}
              {latest.count === 1 ? 'card' : 'cards'}
              <span className="home-added-when">
                Imported {formatDayKey(dayKey(latest.addedAt))}
              </span>
            </p>
          </div>
          {fits.length > 0 && (
            <ul className="home-added-fits" aria-label="Decks with new cards that fit">
              {fits.map(({ deck, count }) => (
                <li key={deck.id}>
                  <Link
                    to={`/decks/${deck.id}`}
                    className="home-added-fit"
                    aria-label={`Open deck: ${deck.name}, ${count} new card${count === 1 ? '' : 's'} that fit`}
                  >
                    <span className="home-added-fit-name">{deck.name}</span>
                    <span className="home-added-fit-count">{count} fit</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </HomeCard>
  );
}
