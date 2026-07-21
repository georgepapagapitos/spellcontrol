import './NewArrivalsCard.css';
import { useMemo } from 'react';
import { PackagePlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDecksStore } from '../../store/decks';
import { useCollectionStore } from '../../store/collection';
import { aggregateNewArrivalDecks } from '../../lib/home-signals';
import { useCardThumb } from '../../lib/card-thumbs';
import { useAnimatedNumber } from '../../lib/use-animated-number';
import { HomeCard } from './HomeCard';

const DISPLAY_LIMIT = 3;
/** Overlapping thumb fan caps at 5 — plenty of visual variety without
 *  crowding a bento card. */
const FAN_LIMIT = 5;

function ArrivalThumb({ name }: { name: string }) {
  const art = useCardThumb(name, 'normal');
  return (
    <span className="home-thumb card-thumb-tilt" aria-hidden="true">
      {art ? <img src={art} alt="" loading="lazy" /> : <span className="home-thumb-skeleton" />}
    </span>
  );
}

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

  const total = useMemo(() => rows.reduce((sum, r) => sum + r.count, 0), [rows]);
  const { display: displayTotal } = useAnimatedNumber(total);

  // Dedupe sample names across decks (two decks can both qualify the same
  // owned card) and cap the fan at FAN_LIMIT.
  const fanNames = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const row of rows) {
      if (names.length >= FAN_LIMIT) break;
      for (const name of row.sampleNames) {
        if (names.length >= FAN_LIMIT) break;
        if (seen.has(name)) continue;
        seen.add(name);
        names.push(name);
      }
    }
    return names;
  }, [rows]);

  return (
    <HomeCard
      title="New arrivals"
      icon={PackagePlus}
      loading={false}
      empty={empty}
      emptyText="No new arrivals to review."
      viewAllHref={rows.length > DISPLAY_LIMIT ? '/decks' : undefined}
    >
      {!empty && (
        <div className="home-arrivals-fan">
          <span className="home-arrivals-fan-thumbs">
            {fanNames.map((name) => (
              <ArrivalThumb key={name} name={name} />
            ))}
          </span>
          <span className="home-arrivals-fan-count">{displayTotal} new</span>
        </div>
      )}
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
