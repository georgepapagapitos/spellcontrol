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
import { imageFromCard, useCardThumb } from '../../lib/card-thumbs';
import { scryfallArtCrop } from '../../lib/offline/slim-to-scryfall';
import { getSyncState, onSyncedChange } from '../../lib/sync';
import { useCurrency } from '../../lib/currency';
import { formatMoney } from '../../lib/format-money';
import { formatIdentity } from '../../lib/display-name';
import { pickHeroCard, heroGreeting } from '../../lib/home-hero';
import {
  computeValueDelta,
  dayKey,
  formatValueDeltaChip,
  getValueHistory,
  type ValuePoint,
} from '../../lib/value-history';

type SearchScope = 'mine' | 'discover';

/**
 * /home's hero panel ("your collection is the hero", featured-card revision):
 * a sleeve-matte panel (T53 material system) with the greeting/value, scoped
 * deck search, and Quick Actions in the main column, and the day's card from
 * the viewer's own collection displayed as an OBJECT — a full, uncropped art
 * crop in a sleeve frame with a tape-label caption — instead of a
 * letterboxed backdrop. (The old full-bleed backdrop cover-cropped a ~4:3
 * illustration into an ~8:1 band, discarding most of the art; no scrim
 * tuning fixes that geometry.) Guests and settled-empty collections get the
 * empty sleeve with the brand mark — never personal data, never a gap.
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
  // builds this exact map itself too) — pickHeroCard stays store-free. Each
  // row also carries its OWNED printing's art crop (imageNormal →
  // scryfallArtCrop, the binder-cover idiom, #843) so the hero shows the
  // copy you actually have, not Scryfall's name-resolved default printing.
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
        art: c.imageNormal ? scryfallArtCrop(c.imageNormal) : undefined,
      })),
    [collectionCards, addedAtByImportId]
  );
  const heroDecks = useMemo(
    () =>
      decks.map((d) => ({
        commanderName: d.commander?.name ?? null,
        updatedAt: d.updatedAt,
        art: d.commander ? imageFromCard(d.commander, 'art_crop') : undefined,
      })),
    [decks]
  );

  // Guests never see personal art, regardless of what a local-only
  // collection might hold (local-first means a guest CAN have local cards/
  // decks) — the hero's background is never personal data for a guest.
  const pick = useMemo(
    () => (authed ? pickHeroCard(heroCards, heroDecks) : null),
    [authed, heroCards, heroDecks]
  );
  // art_crop, never 'normal': a full card scan cover-cropped into a wide band
  // shows a strip of black frame/text box instead of the illustration. Name
  // resolution only runs when the pick has no owned-printing art in hand.
  const fetched = useCardThumb(pick && !pick.art ? pick.name : undefined, 'art_crop');
  const art = pick ? (pick.art ?? fetched) : undefined;

  // While the local IDB hydrate or a first pull on a fresh device is still
  // in flight, an empty collection is indeterminate, not empty — show the
  // loading shimmer, never flash the brand fallback under the search bar.
  // Same subscribe-and-rerender idiom as SyncIndicator.
  const hydrating = useCollectionStore((s) => s.hydrating);
  const [, syncTick] = useState(0);
  useEffect(() => onSyncedChange(() => syncTick((n) => n + 1)), []);
  const settling = authed && !pick && (hydrating || getSyncState() === 'syncing');
  const showFallback = !pick && !settling;

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
      <div className="home-hero-main">
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

        <QuickActionsRow />
      </div>

      <figure className="home-hero-card">
        {pick && art ? (
          <>
            <img className="home-hero-art" src={art} alt="" loading="lazy" />
            <figcaption className="home-hero-caption">
              <span className="home-hero-caption-tape" title={pick.name}>
                {pick.name}
              </span>
              <span className="home-hero-caption-sub">From your collection</span>
            </figcaption>
          </>
        ) : showFallback ? (
          <span className="home-hero-fallback" aria-hidden="true">
            <BrandMark size={48} motion="idle" aria-hidden />
          </span>
        ) : (
          <span className="home-hero-art-loading" aria-hidden="true" />
        )}
      </figure>
    </header>
  );
}
