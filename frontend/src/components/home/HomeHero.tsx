import './HomeHero.css';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarPlus, Check, ChevronRight, Plus, Puzzle, Users } from 'lucide-react';
import { AddCardsSheet } from '@/components/import/AddCardsSheet';
import { OverflowMenu } from '@/components/overlays/OverflowMenu';
import { ValueSparkline } from './ValueSparkline';
import { useAuth } from '../../store/auth';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { imageFromCard, useCardThumb } from '@/lib/cards/card-thumbs';
import { scryfallArtCrop } from '../../lib/offline/slim-to-scryfall';
import { getSyncState, onSyncedChange } from '@/lib/sync';
import { useCurrency } from '@/lib/collection/currency';
import { formatMoney } from '@/lib/collection/format-money';
import { formatIdentity } from '@/lib/social/display-name';
import { pickHeroCard, heroGreeting, type HeroPickReason } from '@/lib/home/home-hero';
import { readHomeShape, rememberHomeShape } from '@/lib/home/home-shape';
import { useAwaitingFirstPull } from '@/lib/sync/use-awaiting-first-pull';
import { useLoadSamples } from '@/lib/home/use-load-samples';
import { track } from '@/lib/util/analytics';
import {
  computeValueDelta,
  dayKey,
  formatValueDeltaChip,
  getValueHistory,
  onValueHistoryChange,
  type ValuePoint,
} from '@/lib/collection/value-history';
import { Button, buttonClass } from '@/components/shared/Button';

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
      <Button
        variant="primary"
        aria-haspopup="dialog"
        onClick={() => setAddOpen(true)}
        className="home-hero-action"
        icon={<Plus width={16} height={16} strokeWidth={1.8} />}
      >
        Add cards
      </Button>
      {secondary}
      <OverflowMenu
        ariaLabel="More actions"
        triggerClassName={`${buttonClass()} home-hero-more`}
        items={[
          {
            label: 'Plan a game night',
            icon: CalendarPlus,
            onClick: () => navigate('/play/nights'),
          },
          { label: 'Daily card', icon: Puzzle, onClick: () => navigate('/daily') },
          { label: 'Social', icon: Users, onClick: () => navigate('/friends') },
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
      href: '/collection?add=list',
      done: false,
    },
    {
      label: 'Build your first binder',
      href: '/collection/binders',
      done: binderCount > 0,
    },
    {
      label: 'Make a deck',
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
                  <span className="home-hero-step-text">{step.label}</span>
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
            <Button
              onClick={() => void trySamples()}
              disabled={loadingSamples}
              className="home-hero-action"
            >
              {loadingSamples ? (
                'Loading samples…'
              ) : (
                <>
                  <span className="home-hero-label-long">Try the sample collection</span>
                  <span className="home-hero-label-short">Try samples</span>
                </>
              )}
            </Button>
          }
        />
        {sampleError && <p className="home-hero-error">{sampleError}</p>}
        <Button
          variant="link"
          href="/guides/"
          onClick={() => track('guide_cta')}
          iconEnd={<ChevronRight width={14} height={14} strokeWidth={1.8} />}
        >
          Read the guides
        </Button>
      </div>
    </>
  );
}

/**
 * /home's hero ("your collection is the hero"): the greeting, the collection's
 * value (the one dominant figure) with its sparkline under it and the actions on
 * the left, as one centered block; the day's card from the viewer's own
 * collection displayed as an OBJECT on the right — a full, uncropped art crop
 * in a sleeve frame with a tape-label caption. The value and its chart live
 * only here: the Value movers card used to restate both word for word.
 *
 * Guests and settled-empty collections get the empty sleeve with one line
 * saying what fills it — never personal data, never a gap — and an empty
 * collection gets the setup checklist in place of the value.
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
  // loading shimmer, never flash the empty-sleeve fallback or the checklist.
  // Same subscribe-and-rerender idiom as SyncIndicator.
  const hydrating = useCollectionStore((s) => s.hydrating);
  // Last visit's resolved hero shape (lib/home/home-shape) — read once at mount.
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

  // The value line reserves its box while pending IF
  // this browser rendered it last time (`remembered`) — the hero otherwise
  // grows under the greeting after first paint (E277). A fresh account has
  // no memory and reserves nothing.
  const valuePending = authed && valueData === undefined;
  useEffect(() => {
    if (authed && !valuePending) rememberHomeShape('hero-value', latestValue !== null ? 1 : 0);
  }, [authed, valuePending, latestValue]);
  const reserveValue = valuePending && remembered['hero-value'] === 1;

  // The scale line: the collection's exact size, one quiet line under the
  // value, each figure a door to its hub. The header's nav chips round past
  // 999 ("14k"), the phone's tab bar carries no counts at all, and binders
  // have no count anywhere on Home without it, so this is the one place the
  // real figures show here (STYLE_GUIDE § Layout system, "A count is said
  // once", the exception). Never the three-tile stat row it replaced, and
  // never for a guest or a row of zeroes.
  const scale = [
    { noun: 'card', value: collectionCards.length, to: '/collection' },
    { noun: 'deck', value: decks.length, to: '/decks' },
    { noun: 'binder', value: binders.length, to: '/collection/binders' },
  ].filter((s) => s.value > 0);
  const showScale = authed && scale.length > 0;
  useEffect(() => {
    if (authed && !hydrating) rememberHomeShape('hero-scale', showScale ? 1 : 0);
  }, [authed, hydrating, showScale]);
  const reserveScale = authed && hydrating && !showScale && remembered['hero-scale'] === 1;

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
        <span className="home-hero-fallback">
          <span className="home-hero-fallback-text">Your first card shows here.</span>
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
      <div className="home-hero-main">
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
                    {chip.changes && (
                      <span className="home-hero-value-changes">{chip.changes}</span>
                    )}
                    <span className="home-hero-value-label">Collection value</span>
                  </div>
                )
              )}
            </>
          ) : (
            <h1 className="home-hero-title">{hello}</h1>
          )}
          {showScale ? (
            <p className="home-hero-scale">
              {scale.map((s, i) => (
                <span key={s.noun}>
                  {i > 0 && ' · '}
                  <Link to={s.to} className="home-hero-scale-link">
                    {s.value.toLocaleString()} {s.value === 1 ? s.noun : `${s.noun}s`}
                  </Link>
                </span>
              ))}
            </p>
          ) : (
            reserveScale && (
              <p className="home-hero-scale home-hero-scale--loading" aria-hidden="true">
                <span> </span>
              </p>
            )
          )}
        </div>

        {showSparkline && valueData && (
          <div className="home-hero-spark">
            <ValueSparkline points={points} today={valueData.today} />
          </div>
        )}

        <div className="home-hero-foot">
          <HeroActions
            secondary={
              <Button
                to="/decks/new"
                className="home-hero-action"
                icon={<Plus width={16} height={16} strokeWidth={1.8} />}
              >
                New deck
              </Button>
            }
          />
        </div>
      </div>

      {figure}
    </header>
  );
}
