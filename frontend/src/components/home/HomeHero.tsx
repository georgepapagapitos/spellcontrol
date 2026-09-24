import './HomeHero.css';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarPlus, Check, ChevronRight, Plus, Upload, Users } from 'lucide-react';
import { BrandMark } from '../shared/BrandMark';
import { AddCardsSheet } from '../AddCardsSheet';
import { OverflowMenu } from '../OverflowMenu';
import { ValueSparkline } from './ValueSparkline';
import { useAuth } from '../../store/auth';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { imageFromCard, useCardThumb } from '../../lib/card-thumbs';
import { scryfallArtCrop } from '../../lib/offline/slim-to-scryfall';
import { getSyncState, onSyncedChange } from '../../lib/sync';
import { useCurrency } from '../../lib/currency';
import { formatMoney } from '../../lib/format-money';
import { formatIdentity } from '../../lib/display-name';
import { pickHeroCard, heroGreeting, type HeroPickReason } from '../../lib/home-hero';
import { readHomeShape, rememberHomeShape } from '../../lib/home-shape';
import { useAwaitingFirstPull } from '../../lib/use-awaiting-first-pull';
import { useLoadSamples } from '../../lib/use-load-samples';
import { track } from '../../lib/analytics';
import {
  computeValueDelta,
  dayKey,
  formatValueDeltaChip,
  getValueHistory,
  onValueHistoryChange,
  type ValuePoint,
} from '../../lib/value-history';

/** Every scale-line label is a plain plural, so one copy of the s-strip
 *  covers all three — "1 Binders" reads as a bug in a figure that small. */
const singularize = (n: number, label: string) => (n === 1 ? label.slice(0, -1) : label);

/** The caption's provenance line states WHY this card was picked — an
 *  unlabeled pick read as random to real users ("why does it pick that
 *  card?"), and the picker always knows its reason. */
const PICK_REASON_LABEL: Record<HeroPickReason, string> = {
  top: 'One of your most valuable cards',
  recent: 'One of your newest arrivals',
  commander: 'Your latest commander',
};

/**
 * The hero's actions, per § Layout system: one filled primary, one outline
 * secondary, and a ⋮ for the rest. They were four equal outline buttons under
 * a search box with a scope toggle — seven controls and no primary. Search
 * moved beside the lists it searches (HomeSectionSearch).
 */
function HeroActions({ secondary }: { secondary: React.ReactNode }) {
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);
  return (
    <div className="home-hero-actions">
      <button
        type="button"
        className="btn btn-primary home-hero-action"
        aria-haspopup="dialog"
        onClick={() => setAddOpen(true)}
      >
        <Upload width={16} height={16} strokeWidth={1.8} aria-hidden />
        Add cards
      </button>
      {secondary}
      <OverflowMenu
        ariaLabel="More actions"
        triggerClassName="btn home-hero-more"
        items={[
          {
            label: 'Plan a game night',
            icon: CalendarPlus,
            onClick: () => navigate('/play/nights'),
          },
          { label: 'Friends', icon: Users, onClick: () => navigate('/friends') },
        ]}
      />
      {addOpen && <AddCardsSheet onClose={() => setAddOpen(false)} />}
    </div>
  );
}

/**
 * An empty collection's hero IS the setup checklist (it used to be a separate
 * Get started card beside eight empty rows). Done steps stay listed, ticked,
 * so the order reads as progress. Once the collection has cards the hero
 * switches to the collection and any steps left move to Waiting on you.
 */
function HeroChecklist({ greeting }: { greeting: string }) {
  const navigate = useNavigate();
  const binderCount = useCollectionStore((s) => s.binders.length);
  const deckCount = useDecksStore((s) => s.decks.length);
  const { load: loadSamples, loading: loadingSamples, error: sampleError } = useLoadSamples();

  const steps = [
    {
      label: 'Add your collection',
      hint: 'Paste a list, upload a file or scan',
      href: '/collection?add=list',
      done: false,
    },
    {
      label: 'Build your first binder',
      hint: 'Rules sort your cards for you',
      href: '/collection/binders',
      done: binderCount > 0,
    },
    {
      label: 'Make a deck',
      hint: 'From scratch, or start from a draft',
      href: '/decks/new',
      done: deckCount > 0,
    },
  ];

  async function trySamples() {
    const ok = await loadSamples();
    if (!ok) return;
    track('sample_loaded');
    navigate('/collection');
  }

  return (
    <>
      <div className="home-hero-head">
        <p className="home-hero-hello">{greeting}</p>
        <h1 className="home-hero-title">Start with your cards</h1>
        <ol className="home-hero-steps">
          {steps.map((step, i) => (
            <li key={step.label}>
              {step.done ? (
                <span className="home-hero-step is-done">
                  <span className="home-hero-step-mark" aria-hidden="true">
                    <Check width={14} height={14} strokeWidth={2.6} />
                  </span>
                  <span className="home-hero-step-text">
                    {step.label}
                    <span className="sr-only">, done</span>
                  </span>
                </span>
              ) : (
                <Link to={step.href} className="home-hero-step">
                  <span className="home-hero-step-mark" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="home-hero-step-text">
                    {step.label}
                    <span className="home-hero-step-hint">{step.hint}</span>
                  </span>
                  <ChevronRight
                    className="home-hero-step-chevron"
                    width={16}
                    height={16}
                    strokeWidth={1.8}
                    aria-hidden
                  />
                </Link>
              )}
            </li>
          ))}
        </ol>
      </div>
      <div className="home-hero-foot">
        <HeroActions
          secondary={
            <button
              type="button"
              className="btn home-hero-action"
              onClick={() => void trySamples()}
              disabled={loadingSamples}
            >
              {loadingSamples ? (
                'Loading samples…'
              ) : (
                <>
                  <span className="home-hero-label-long">Try the sample collection</span>
                  <span className="home-hero-label-short">Try samples</span>
                </>
              )}
            </button>
          }
        />
        {sampleError && <p className="home-hero-error">{sampleError}</p>}
        <a href="/guides/" className="home-door" onClick={() => track('guide_cta')}>
          Read the guides
          <ChevronRight width={14} height={14} strokeWidth={2} aria-hidden />
        </a>
      </div>
    </>
  );
}

/**
 * /home's hero ("your collection is the hero"): the greeting, the collection's
 * value with its sparkline under it, the scale line (cards/decks/binders, each
 * a door) and the actions on the left; the day's card from the viewer's own
 * collection displayed as an OBJECT on the right — a full, uncropped art crop
 * in a sleeve frame with a tape-label caption. The value and its chart live
 * only here: the Value movers card used to restate both word for word.
 *
 * Guests and settled-empty collections get the empty sleeve with the brand
 * mark — never personal data, never a gap — and an empty collection gets the
 * setup checklist in place of the value.
 */
export function HomeHero() {
  const authed = useAuth((s) => s.status === 'authed');
  const user = useAuth((s) => s.user);
  const profile = useAuth((s) => s.profile);

  const collectionCards = useCollectionStore((s) => s.cards);
  const binders = useCollectionStore((s) => s.binders);
  const importHistory = useCollectionStore((s) => s.importHistory);
  const decks = useDecksStore((s) => s.decks);
  const decksHydrated = useDecksStore((s) => s.hydrated);
  const awaitingFirstPull = useAwaitingFirstPull();

  // Same acquiredAt derivation as home-signals.ts's own (private) helper:
  // import time, falling back to last-edited. Each row also carries its OWNED
  // printing's art crop (imageNormal → scryfallArtCrop, the binder-cover
  // idiom, #843) so the hero shows the copy you actually have, not
  // Scryfall's name-resolved default printing.
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
  // decks) — the hero is never personal data for a guest.
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
  // loading shimmer, never flash the brand fallback or the checklist.
  // Same subscribe-and-rerender idiom as SyncIndicator.
  const hydrating = useCollectionStore((s) => s.hydrating);
  // Last visit's resolved hero shape (lib/home-shape) — read once at mount.
  const [remembered] = useState(() => readHomeShape());
  const [, syncTick] = useState(0);
  useEffect(() => onSyncedChange(() => syncTick((n) => n + 1)), []);
  const settling = authed && !pick && (hydrating || getSyncState() === 'syncing');
  const showFallback = !pick && !settling;
  const fresh =
    !hydrating && decksHydrated && !awaitingFirstPull && !settling && collectionCards.length === 0;
  useEffect(() => {
    if (authed && !settling && (!pick || art))
      rememberHomeShape('hero-caption', pick && art ? 1 : 0);
  }, [authed, settling, pick, art]);

  const currency = useCurrency();
  // today is captured inside the async callback, not read via Date.now() in
  // the render body — react-hooks/purity forbids the latter.
  const [valueData, setValueData] = useState<{ points: ValuePoint[]; today: string } | undefined>(
    undefined
  );
  // Re-read whenever the log itself is written. Every writer is a
  // fire-and-forget background path — the collection subscriber, the boot
  // catch-all in autoRefreshStalePrices, the price-refresh tick — and several
  // of them land AFTER this component mounted, so watching the log beats
  // guessing at a proxy.
  const [logTick, setLogTick] = useState(0);
  useEffect(() => onValueHistoryChange(() => setLogTick((n) => n + 1)), []);
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
  }, [authed, currency, logTick]);

  const points = valueData?.points ?? [];
  const delta = computeValueDelta(points);
  const chip = formatValueDeltaChip(delta, valueData?.today ?? '');
  const latestValue = points.length > 0 ? points[points.length - 1].value : null;
  const showSparkline = points.length >= 2 && delta !== null;

  // Both async lines below (value, scale) reserve their box while pending IF
  // this browser rendered them last time (`remembered`) — the hero otherwise
  // grows under the greeting after first paint (E277). A fresh account has
  // no memory and reserves nothing.
  const valuePending = authed && valueData === undefined;
  useEffect(() => {
    if (authed && !valuePending) rememberHomeShape('hero-value', latestValue !== null ? 1 : 0);
  }, [authed, valuePending, latestValue]);
  const reserveValue = valuePending && remembered['hero-value'] === 1;

  // Scale line: the three things this collection IS, each one a door. The
  // header's nav chips carry two of these abbreviated ("12K"); these are the
  // real figures, and they're clickable. Suppressed wholesale on a fresh
  // account — a row of zeroes is worse than no row.
  const stats = [
    { label: 'Cards', value: collectionCards.length, to: '/collection' },
    { label: 'Decks', value: decks.length, to: '/decks' },
    { label: 'Binders', value: binders.length, to: '/collection/binders' },
  ];
  const showStats = authed && stats.some((s) => s.value > 0);
  useEffect(() => {
    if (authed && !hydrating) rememberHomeShape('hero-stats', showStats ? 1 : 0);
  }, [authed, hydrating, showStats]);
  const reserveStats = authed && hydrating && !showStats && remembered['hero-stats'] === 1;

  const name = formatIdentity({
    username: user?.username ?? '',
    displayName: profile?.displayName ?? null,
  }).primary;
  const greeting = heroGreeting();
  const hello = name ? `${greeting}, ${name}` : greeting;

  const figure = (
    <figure className="home-hero-card">
      {pick && art ? (
        <>
          <img className="home-hero-art" src={art} alt="" loading="lazy" />
          <figcaption className="home-hero-caption">
            <span className="home-hero-caption-tape" title={pick.name}>
              {pick.name}
            </span>
            <span className="home-hero-caption-sub">{PICK_REASON_LABEL[pick.reason]}</span>
          </figcaption>
        </>
      ) : showFallback ? (
        <span className="home-hero-fallback" aria-hidden="true">
          <BrandMark size={48} motion="idle" aria-hidden />
        </span>
      ) : (
        <>
          <span className="home-hero-art-loading" aria-hidden="true" />
          {remembered['hero-caption'] === 1 && (
            <span className="home-hero-caption home-hero-caption--loading" aria-hidden="true">
              <span className="home-hero-caption-tape">{' '}</span>
              <span className="home-hero-caption-sub">{' '}</span>
            </span>
          )}
        </>
      )}
    </figure>
  );

  if (fresh) {
    return (
      <header className="home-hero home-hero--checklist">
        <HeroChecklist greeting={authed ? hello : 'Welcome to SpellControl'} />
        {figure}
      </header>
    );
  }

  const hasValue = latestValue !== null || reserveValue;

  return (
    <header className="home-hero">
      <div className="home-hero-head">
        {!authed ? (
          <h1 className="home-hero-title">Plan your Magic: The Gathering collection</h1>
        ) : hasValue ? (
          <>
            <h1 className="home-hero-hello">{hello}</h1>
            {reserveValue ? (
              <div className="home-hero-value home-hero-value--loading" aria-hidden="true">
                <span className="home-hero-value-amount">{' '}</span>
              </div>
            ) : (
              latestValue !== null && (
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
              )
            )}
          </>
        ) : (
          <h1 className="home-hero-title">{hello}</h1>
        )}
      </div>

      {figure}

      {showSparkline && valueData && (
        <div className="home-hero-spark">
          <ValueSparkline points={points} today={valueData.today} />
        </div>
      )}

      <div className="home-hero-foot">
        {reserveStats && (
          <ul className="home-hero-stats home-hero-stats--loading" aria-hidden="true">
            {stats.map((stat) => (
              <li key={stat.label}>
                <span className="home-hero-stat">
                  <span className="home-hero-stat-value">{' '}</span>
                  <span className="home-hero-stat-label">{stat.label}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {showStats && (
          <ul className="home-hero-stats">
            {stats.map((stat) => (
              <li key={stat.label}>
                <Link
                  to={stat.to}
                  className="home-hero-stat"
                  aria-label={`${stat.value.toLocaleString()} ${singularize(
                    stat.value,
                    stat.label
                  ).toLowerCase()}`}
                >
                  <span className="home-hero-stat-value">{stat.value.toLocaleString()}</span>
                  <span className="home-hero-stat-label">
                    {singularize(stat.value, stat.label)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <HeroActions
          secondary={
            <Link to="/decks/new" className="btn home-hero-action">
              <Plus width={16} height={16} strokeWidth={1.8} aria-hidden />
              New deck
            </Link>
          }
        />
      </div>
    </header>
  );
}
