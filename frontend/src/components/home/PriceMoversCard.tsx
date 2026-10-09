import './PriceMoversCard.css';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { useCollectionStore } from '../../store/collection';
import { useCurrency } from '@/lib/collection/currency';
import { formatMoney } from '@/lib/collection/format-money';
import { cachedCardThumb, useCardThumb } from '@/lib/cards/card-thumbs';
import { thumbSrcSet } from '@/lib/cards/thumb-srcset';
import type { EnrichedCard, Finish } from '@/types';
import {
  dayKey,
  daysBetween,
  formatDayKey,
  getLatestMovers,
  onValueHistoryChange,
  type CardMover,
  type MoverRecord,
} from '@/lib/collection/value-history';
import { HomeCard } from './HomeCard';

// Loaded on the first tap: Home never pays for the preview until it is used.
const CardPreview = lazy(() =>
  import('@/components/card/CardPreview').then((m) => ({ default: m.CardPreview }))
);

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
      {src ? (
        // The tile is at most 7.5rem wide (the wide layout); a 1x screen
        // takes Scryfall's sharper `small` there (lib/cards/thumb-srcset.ts).
        <img src={src} srcSet={thumbSrcSet(src)} sizes="7.5rem" alt="" loading="lazy" />
      ) : (
        <span className="home-thumb-skeleton" />
      )}
    </span>
  );
}

/**
 * The mover as a card the preview can show. The copy you hold when there is
 * one (its binders, condition and price come with it); otherwise, for a
 * printing that left the collection since the refresh, a stand-in carrying
 * the mover's own printing, finish and price, with the art the thumbnail
 * already resolved. The preview fetches the rest by scryfallId.
 */
function previewCard(m: CardMover, owned: EnrichedCard | undefined): EnrichedCard {
  if (owned) return owned;
  return {
    copyId: `mover:${m.scryfallId}:${m.finish}`,
    name: m.name,
    setCode: m.setCode,
    setName: '',
    collectorNumber: '',
    rarity: '',
    scryfallId: m.scryfallId,
    purchasePrice: m.after,
    sourceCategory: '',
    sourceFormat: '',
    finish: m.finish as Finish,
    foil: m.finish === 'foil',
    imageNormal: cachedCardThumb(m.name),
  };
}

/** "Down $6.83 (39%) today": the move, in words, as the preview's context line. */
function moveLabel(m: CardMover, when: string): string {
  const move = m.after - m.before;
  const pct = m.before !== 0 ? ` (${Math.abs(Math.round((move / m.before) * 100))}%)` : '';
  return `${move > 0 ? 'Up' : 'Down'} ${formatMoney(Math.abs(move))}${pct} ${when}`;
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
  // The copy held of each mover's printing, the same finish when there is one.
  const ownedCopy = useMemo(() => {
    const want = new Map(shown.map((m) => [m.scryfallId, m.finish]));
    const found = new Map<string, EnrichedCard>();
    if (want.size === 0) return found;
    for (const card of collectionCards) {
      const finish = want.get(card.scryfallId);
      if (finish === undefined) continue;
      const prev = found.get(card.scryfallId);
      if (!prev || (prev.finish !== finish && card.finish === finish)) {
        found.set(card.scryfallId, card);
      }
    }
    return found;
  }, [collectionCards, shown]);

  // A snapshot taken on the tap, so a refresh that rewrites the log under an
  // open preview can't swap the cards out from under it.
  const [preview, setPreview] = useState<{
    cards: EnrichedCard[];
    labels: string[];
    index: number;
  } | null>(null);
  const openPreview = (index: number) => {
    const when = data && movers ? whenLabel(movers.day, data.today) : '';
    setPreview({
      cards: shown.map((m) => previewCard(m, ownedCopy.get(m.scryfallId))),
      labels: shown.map((m) => moveLabel(m, when)),
      index,
    });
  };

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
      <ul className="list-stack home-movers-list">
        {shown.map((m, i) => {
          const moveAmount = m.after - m.before;
          const up = moveAmount > 0;
          const pct = m.before !== 0 ? Math.round((moveAmount / m.before) * 100) : null;
          return (
            <li key={`${m.scryfallId}:${m.finish}`}>
              <button type="button" className="home-movers-row" onClick={() => openPreview(i)}>
                <MoverThumb name={m.name} owned={ownedCopy.get(m.scryfallId)?.imageNormal} />
                <span className="home-movers-info">
                  <span className="home-movers-name">{m.name}</span>
                  <span className="home-movers-price">
                    {formatMoney(m.after)}
                    {/* Ranked by total impact, so name the copies that make a
                      small per-copy move rank high. */}
                    {m.copies > 1 && ` · ×${m.copies}`}
                  </span>
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
              </button>
            </li>
          );
        })}
      </ul>
      {preview && (
        <Suspense fallback={null}>
          <CardPreview
            source="collection"
            cards={preview.cards}
            index={preview.index}
            binderName="Price movers"
            sectionLabels={preview.labels}
            pageNumbers={preview.cards.map(() => 0)}
            totalPages={0}
            onIndexChange={(index) => setPreview((p) => (p ? { ...p, index } : p))}
            onClose={() => setPreview(null)}
          />
        </Suspense>
      )}
    </HomeCard>
  );
}
