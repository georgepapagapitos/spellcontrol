import './PriceMoversCard.css';
import { useEffect, useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { useCollectionStore } from '../../store/collection';
import { useCurrency } from '../../lib/currency';
import { formatMoney } from '../../lib/format-money';
import { useCardThumb } from '../../lib/card-thumbs';
import {
  dayKey,
  daysBetween,
  formatDayKey,
  getLatestMovers,
  onValueHistoryChange,
  type MoverRecord,
} from '../../lib/value-history';
import { HomeCard } from './HomeCard';

const DISPLAY_LIMIT = 4;
/** A movers record older than this reads as stale, not "news" — mirrors ValueTrend's own gate. */
const FRESHNESS_DAYS = 2;

interface MoversData {
  movers: MoverRecord | null;
  /** Day key captured when the read resolved — computed inside the async
   *  callback rather than the render body (react-hooks/purity forbids
   *  calling Date.now() while rendering). */
  today: string;
}

/**
 * `owned` is the art of the printing the user actually holds, keyed off the
 * mover's `scryfallId` — a mover IS a printing (prices move per printing), so
 * showing a name-resolved default printing misrepresented what moved. Falls
 * back to the name lookup only for a card enriched before `imageNormal`
 * existed, or one that left the collection since the refresh that logged it.
 */
function MoverThumb({ name, owned }: { name: string; owned?: string }) {
  const art = useCardThumb(owned ? undefined : name, 'normal');
  const src = owned ?? art;
  return (
    <span className="home-thumb home-mover-thumb card-thumb-tilt" aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" /> : <span className="home-thumb-skeleton" />}
    </span>
  );
}

function whenLabel(day: string, today: string): string {
  const gap = daysBetween(day, today);
  if (gap <= 0) return 'today';
  if (gap === 1) return 'yesterday';
  return formatDayKey(day);
}

/**
 * The cards whose price moved most at the latest local price refresh. The
 * collection's total and its trend live in the hero (one fact, one place);
 * this card is only the cards themselves. It lays out as rows in a narrow
 * card and as card tiles once it is wide enough (a container query in the
 * CSS), because a 690px row at desktop width read as a name at one end and
 * a number at the other. With no fresh refresh it renders nothing.
 */
export function PriceMoversCard() {
  const [data, setData] = useState<MoversData | undefined>(undefined);
  // getLatestMovers filters to the active display currency — reload on switch.
  const currency = useCurrency();
  // …and re-read whenever the log is written. The writers are all
  // fire-and-forget background paths that can land after this card mounted
  // (the boot catch-all in autoRefreshStalePrices is exactly that), so it
  // watches the log itself rather than a store-shaped proxy for it.
  const [logTick, setLogTick] = useState(0);
  useEffect(() => onValueHistoryChange(() => setLogTick((n) => n + 1)), []);

  useEffect(() => {
    let stale = false;
    getLatestMovers()
      .then((latest) => {
        if (!stale) setData({ movers: latest, today: dayKey(Date.now()) });
      })
      .catch(() => {
        // IndexedDB unavailable (private mode) — reads as "nothing yet".
        if (!stale) setData({ movers: null, today: dayKey(Date.now()) });
      });
    return () => {
      stale = true;
    };
  }, [currency, logTick]);

  const movers = data?.movers;
  const shown = useMemo(() => movers?.movers.slice(0, DISPLAY_LIMIT) ?? [], [movers]);

  const collectionCards = useCollectionStore((s) => s.cards);
  const ownedArt = useMemo(() => {
    const want = new Set(shown.map((m) => m.scryfallId));
    const found = new Map<string, string>();
    if (want.size === 0) return found;
    for (const card of collectionCards) {
      if (found.size === want.size) break;
      if (card.imageNormal && want.has(card.scryfallId) && !found.has(card.scryfallId)) {
        found.set(card.scryfallId, card.imageNormal);
      }
    }
    return found;
  }, [collectionCards, shown]);

  const fresh =
    !!data &&
    movers != null &&
    movers.movers.length > 0 &&
    daysBetween(movers.day, data.today) <= FRESHNESS_DAYS;

  return (
    <HomeCard
      title="Price movers"
      icon={TrendingUp}
      meta={fresh && movers && data ? whenLabel(movers.day, data.today) : undefined}
      loading={data === undefined}
      empty={!fresh}
      viewAllHref="/collection"
      viewAllLabel="View trend"
      className="home-movers-card"
    >
      <ul className="home-movers-list">
        {shown.map((m) => {
          const moveAmount = m.after - m.before;
          const up = moveAmount > 0;
          const pct = m.before !== 0 ? Math.round((moveAmount / m.before) * 100) : null;
          return (
            <li key={`${m.scryfallId}:${m.finish}`} className="home-movers-row">
              <MoverThumb name={m.name} owned={ownedArt.get(m.scryfallId)} />
              <span className="home-movers-info">
                <span className="home-movers-name">{m.name}</span>
                <span className="home-movers-price">{formatMoney(m.after)}</span>
              </span>
              <span className={`home-movers-delta home-movers-delta--${up ? 'up' : 'down'}`}>
                <span aria-hidden="true">{up ? '▲' : '▼'}</span>
                <span className="sr-only">{up ? 'up' : 'down'}</span>
                <span className="home-movers-delta-amount">
                  {up ? '+' : '−'}
                  {formatMoney(Math.abs(moveAmount))}
                </span>
                {pct !== null && (
                  <span className="home-movers-delta-pct">
                    ({up ? '+' : '−'}
                    {Math.abs(pct)}%)
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </HomeCard>
  );
}
