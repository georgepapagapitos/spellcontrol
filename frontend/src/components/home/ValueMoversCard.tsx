import './ValueMoversCard.css';
import { useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { useCurrency } from '../../lib/currency';
import { formatMoney } from '../../lib/format-money';
import {
  dayKey,
  daysBetween,
  getLatestMovers,
  getValueHistory,
  type MoverRecord,
} from '../../lib/value-history';
import { HomeCard } from './HomeCard';

const DISPLAY_LIMIT = 3;
/** A movers record older than this reads as stale, not "news" — mirrors ValueTrend's own gate. */
const FRESHNESS_DAYS = 2;

interface MoversData {
  movers: MoverRecord | null;
  /** Day key captured when the read resolved — mirrors ValueTrend.tsx's own
   *  `today`, computed inside the async callback rather than the render body
   *  (react-hooks/purity forbids calling Date.now() while rendering). */
  today: string;
}

/**
 * Home's value-movers summary — the top price movers from the latest local
 * price refresh. Mount-time `Promise.all` read of the same device-local
 * IndexedDB log ValueTrend.tsx already reads; this surfaces a smaller slice
 * of the same signal, never a re-capture.
 */
export function ValueMoversCard() {
  const [data, setData] = useState<MoversData | undefined>(undefined);
  // getLatestMovers filters to the active display currency — reload on switch.
  const currency = useCurrency();

  useEffect(() => {
    let stale = false;
    Promise.all([getValueHistory(), getLatestMovers()])
      .then(([, latest]) => {
        if (!stale) setData({ movers: latest, today: dayKey(Date.now()) });
      })
      .catch(() => {
        // IndexedDB unavailable (private mode) — reads as "nothing yet".
        if (!stale) setData({ movers: null, today: dayKey(Date.now()) });
      });
    return () => {
      stale = true;
    };
  }, [currency]);

  const movers = data?.movers;
  const fresh =
    !!data &&
    movers != null &&
    movers.movers.length > 0 &&
    daysBetween(movers.day, data.today) <= FRESHNESS_DAYS;

  return (
    <HomeCard
      title="Value movers"
      icon={TrendingUp}
      loading={data === undefined}
      empty={!fresh}
      emptyText="Price history builds after your next refresh."
      viewAllHref="/collection"
      viewAllLabel="View trend"
    >
      {fresh && movers && (
        <ul className="home-movers-list">
          {movers.movers.slice(0, DISPLAY_LIMIT).map((m) => {
            const delta = m.after - m.before;
            const up = delta > 0;
            return (
              <li key={`${m.scryfallId}:${m.finish}`} className="home-movers-row">
                <span className="home-movers-name">{m.name}</span>
                <span className={`home-movers-delta home-movers-delta--${up ? 'up' : 'down'}`}>
                  {up ? '+' : '−'}
                  {formatMoney(Math.abs(delta))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </HomeCard>
  );
}
