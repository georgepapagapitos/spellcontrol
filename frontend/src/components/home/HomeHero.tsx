import './HomeHero.css';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { BrandMark } from '../shared/BrandMark';
import { SearchPill } from '../SearchPill';
import { QuickActionsRow } from './QuickActionsRow';
import { useAuth } from '../../store/auth';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { useCardThumb } from '../../lib/card-thumbs';
import { useCurrency } from '../../lib/currency';
import { formatMoney } from '../../lib/format-money';
import { formatIdentity } from '../../lib/display-name';
import { pickHeroCardName, heroGreeting } from '../../lib/home-hero';
import {
  computeValueDelta,
  dayKey,
  formatValueDeltaChip,
  getValueHistory,
  type ValuePoint,
} from '../../lib/value-history';

type SearchScope = 'mine' | 'discover';

/**
 * /home's hero band (social program pass 2b — "your collection is the
 * hero"): a full-bleed art backdrop drawn from the viewer's own collection,
 * the greeting + collection value on a theme-invariant scrim, a scoped deck
 * search, and Quick Actions along the bottom edge. Guests (and a brand-new
 * empty collection) get the same layout with the brand fallback instead of
 * personal data — never a broken-looking gap where the art would be.
 */
export function HomeHero() {
  const navigate = useNavigate();
  const authed = useAuth((s) => s.status === 'authed');
  const user = useAuth((s) => s.user);
  const profile = useAuth((s) => s.profile);

  const collectionCards = useCollectionStore((s) => s.cards);
  const importHistory = useCollectionStore((s) => s.importHistory);
  const decks = useDecksStore((s) => s.decks);

  // Same acquiredAt derivation as home-signals.ts's own (private) helper:
  // import time, falling back to last-edited. Component-level, like every
  // other home card's own store-to-plain-data mapping (NewArrivalsCard
  // builds this exact map itself too) — pickHeroCardName stays store-free.
  const addedAtByImportId = useMemo(
    () => new Map(importHistory.map((e) => [e.id, e.addedAt])),
    [importHistory]
  );
  const heroCards = useMemo(
    () =>
      collectionCards.map((c) => ({
        name: c.name,
        purchasePrice: c.purchasePrice,
        acquiredAt: c.importId ? (addedAtByImportId.get(c.importId) ?? 0) : (c.updatedAt ?? 0),
      })),
    [collectionCards, addedAtByImportId]
  );
  const heroDecks = useMemo(
    () => decks.map((d) => ({ commanderName: d.commander?.name ?? null, updatedAt: d.updatedAt })),
    [decks]
  );

  // Guests never see personal art, regardless of what a local-only
  // collection might hold (local-first means a guest CAN have local cards/
  // decks) — the hero's background is never personal data for a guest.
  const heroCardName = useMemo(
    () => (authed ? pickHeroCardName(heroCards, heroDecks) : null),
    [authed, heroCards, heroDecks]
  );
  const art = useCardThumb(heroCardName ?? undefined, 'normal');
  const showFallback = !heroCardName;

  const currency = useCurrency();
  // today is captured inside the async callback, not read via Date.now() in
  // the render body — react-hooks/purity forbids the latter (mirrors
  // ValueMoversCard's own MoversData.today for the identical reason).
  const [valueData, setValueData] = useState<{ points: ValuePoint[]; today: string } | undefined>(
    undefined
  );
  useEffect(() => {
    if (!authed) return;
    let stale = false;
    getValueHistory()
      .then((points) => {
        if (!stale) setValueData({ points, today: dayKey(Date.now()) });
      })
      .catch(() => {
        if (!stale) setValueData({ points: [], today: dayKey(Date.now()) });
      });
    return () => {
      stale = true;
    };
  }, [authed, currency]);

  const points = valueData?.points ?? [];
  const delta = computeValueDelta(points);
  const chip = formatValueDeltaChip(delta, valueData?.today ?? '');
  const latestValue = points.length > 0 ? points[points.length - 1].value : null;

  const name = formatIdentity({
    username: user?.username ?? '',
    displayName: profile?.displayName ?? null,
  }).primary;
  const greeting = heroGreeting();

  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('mine');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const term = query.trim();
    if (scope === 'mine') {
      navigate(term ? `/decks?query=${encodeURIComponent(term)}` : '/decks');
    } else {
      navigate(term ? `/decks/discover?commander=${encodeURIComponent(term)}` : '/decks/discover');
    }
  }

  return (
    <header className="home-hero">
      <div className="home-hero-backdrop" aria-hidden="true">
        {showFallback ? (
          <span className="home-hero-fallback">
            <BrandMark size={64} motion="idle" aria-hidden />
          </span>
        ) : art ? (
          <img className="home-hero-art" src={art} alt="" aria-hidden="true" loading="lazy" />
        ) : (
          <span className="home-hero-art-loading" />
        )}
        <span className="home-hero-scrim" />
      </div>

      <div className="home-hero-content">
        <div className="home-hero-headline">
          {authed ? (
            <>
              <h1 className="home-hero-greeting">{name ? `${greeting}, ${name}` : greeting}</h1>
              {latestValue !== null && (
                <div className="home-hero-value">
                  <span className="home-hero-value-amount">
                    {formatMoney(latestValue, { wholeDollars: true })}
                  </span>
                  {chip.text && (
                    <span
                      className={`home-hero-value-delta home-hero-value-delta--${chip.direction}`}
                    >
                      {chip.text}
                    </span>
                  )}
                </div>
              )}
            </>
          ) : (
            <h1 className="home-hero-greeting">Plan your Magic: The Gathering collection</h1>
          )}
        </div>

        <form className="home-hero-search" role="search" onSubmit={handleSubmit}>
          <div className="home-hero-search-scope" role="group" aria-label="Search scope">
            <button
              type="button"
              className="home-hero-scope-btn"
              aria-pressed={scope === 'mine'}
              onClick={() => setScope('mine')}
            >
              My decks
            </button>
            <button
              type="button"
              className="home-hero-scope-btn"
              aria-pressed={scope === 'discover'}
              onClick={() => setScope('discover')}
            >
              Discover
            </button>
          </div>
          <SearchPill
            value={query}
            onChange={setQuery}
            placeholder={scope === 'mine' ? 'Search your decks' : 'Search commanders'}
            ariaLabel={scope === 'mine' ? 'Search your decks' : 'Search public decks by commander'}
            className="home-hero-search-pill"
            trailing={
              <button type="submit" className="home-hero-search-submit" aria-label="Search">
                <ArrowRight width={16} height={16} strokeWidth={2} aria-hidden />
              </button>
            }
          />
        </form>
      </div>

      <QuickActionsRow />

      {!showFallback && art && (
        <p className="home-hero-caption">{heroCardName} — from your collection</p>
      )}
    </header>
  );
}
