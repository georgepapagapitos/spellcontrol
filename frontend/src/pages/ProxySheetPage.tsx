import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Navigate, useParams } from 'react-router-dom';
import { Printer, RotateCw } from 'lucide-react';
import { BackLink } from '@/components/BackLink';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/shared/Button';
import { EmptyState } from '@/components/shared/EmptyState';
import { MeterBar } from '@/components/shared/MeterBar';
import { Field, SegmentedControl, SwitchRow } from '@/components/shared/form';
import { useCollectionByCopyId } from '@/lib/allocations';
import { useAwaitingFirstPull } from '@/lib/use-awaiting-first-pull';
import { useDocumentTitle } from '@/lib/use-document-title';
import {
  buildProxyTiles,
  chunkPages,
  proxySlots,
  retryUrl,
  selectProxyCards,
  type ProxyScope,
  type ProxyTile,
} from '@/lib/proxy-sheet';
import { useDecksStore } from '@/store/decks';
import './ProxySheetPage.css';

type ImageStatus = 'loaded' | 'failed';

/** A tile as rendered: the URL to load now (after any retries) and its state. */
interface SheetTile extends ProxyTile {
  src: string | undefined;
  status: ImageStatus | 'loading';
}

/**
 * Only while this page is mounted: the printer's margins. An `@page` rule in
 * the page's stylesheet would stay in the document after navigating away (a
 * lazy chunk's CSS is never removed) and change every later print, so it
 * lives in a `<style>` that unmounts with the page. 5 mm leaves room for the
 * 195 × 267 mm sheet (cards plus crop marks) on Letter as well as A4.
 */
const PAGE_RULE = '@page { size: auto; margin: 5mm; }';

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * Print proxies (`/decks/:id/proxies`): the deck's cards at real size, nine
 * to a page with crop marks, to sleeve in front of a real card for playtesting.
 *
 * The screen shows scaled page previews and the controls; what prints is a
 * separate full-size copy portalled to `<body>`. The app shell is a 100dvh
 * box that clips its scroll region, so anything printed from inside it stops
 * after one page; the print rules in ProxySheetPage.css hide every other
 * child of `<body>` only while that portal exists.
 */
export function ProxySheetPage() {
  const { id } = useParams<{ id: string }>();
  const deck = useDecksStore((s) => (id ? s.decks.find((d) => d.id === id) : undefined));
  const decksHydrated = useDecksStore((s) => s.hydrated);
  const awaitingFirstPull = useAwaitingFirstPull();
  const collectionById = useCollectionByCopyId();
  useDocumentTitle(deck ? `Print proxies · ${deck.name}` : 'Print proxies');

  // null until the player picks: the default follows whether anything is missing.
  const [scopeChoice, setScopeChoice] = useState<ProxyScope | null>(null);
  const [skipBasics, setSkipBasics] = useState(true);
  const [includeSideboard, setIncludeSideboard] = useState(false);
  // Keyed by the card's own image URL: every copy of a card shares one load.
  const [attempts, setAttempts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<Record<string, ImageStatus>>({});

  const slots = useMemo(
    () => (deck ? proxySlots(deck, includeSideboard) : []),
    [deck, includeSideboard]
  );
  const missingCards = useMemo(
    () => selectProxyCards(slots, { scope: 'missing', skipBasics }, collectionById),
    [slots, skipBasics, collectionById]
  );
  const deckCards = useMemo(
    () => selectProxyCards(slots, { scope: 'deck', skipBasics }, collectionById),
    [slots, skipBasics, collectionById]
  );
  const hasMissing = missingCards.length > 0;
  const scope: ProxyScope = hasMissing ? (scopeChoice ?? 'missing') : 'deck';
  const cards = scope === 'missing' ? missingCards : deckCards;

  const tiles: SheetTile[] = useMemo(
    () =>
      buildProxyTiles(cards).map((t) => {
        const src = t.imageUrl ? retryUrl(t.imageUrl, attempts[t.imageUrl] ?? 0) : undefined;
        return { ...t, src, status: src ? (status[src] ?? 'loading') : 'failed' };
      }),
    [cards, attempts, status]
  );
  const pages = useMemo(() => chunkPages(tiles), [tiles]);

  const mark = useCallback((src: string, next: ImageStatus) => {
    setStatus((prev) => (prev[src] === next ? prev : { ...prev, [src]: next }));
  }, []);
  const retry = useCallback((urls: string[]) => {
    setAttempts((prev) => {
      const next = { ...prev };
      for (const url of urls) next[url] = (next[url] ?? 0) + 1;
      return next;
    });
  }, []);

  if (!id) return <Navigate to="/decks" replace />;

  if (!decksHydrated || (!deck && awaitingFirstPull) || (deck && !collectionById)) {
    return (
      <div className="proxy-sheet" role="status" aria-label="Loading" aria-busy="true">
        <span className="deck-analysis-skeleton-bar proxy-sheet-skeleton-title" />
        <span className="deck-analysis-skeleton-bar proxy-sheet-skeleton-controls" />
        <div className="proxy-sheet-skeleton-pages" aria-hidden="true">
          <span className="deck-analysis-skeleton-bar proxy-sheet-skeleton-page" />
          <span className="deck-analysis-skeleton-bar proxy-sheet-skeleton-page" />
        </div>
      </div>
    );
  }

  if (!deck) {
    return (
      <div className="proxy-sheet">
        <EmptyState
          taglineAs="h1"
          tagline="That deck no longer exists."
          hint="Pick another deck to print proxies for."
          actions={
            <Button variant="primary" to="/decks">
              Back to decks
            </Button>
          }
        />
      </div>
    );
  }

  const failed = tiles.filter((t) => t.status === 'failed');
  const loadedCount = tiles.filter((t) => t.status === 'loaded').length;
  const pending = tiles.length - loadedCount - failed.length;
  const ready = tiles.length > 0 && pending === 0;
  const retryable = [...new Set(failed.flatMap((t) => (t.imageUrl && t.src ? [t.imageUrl] : [])))];
  const backFaces = tiles.filter((t) => t.back).length;
  const summary =
    tiles.length === 0
      ? undefined
      : [
          plural(cards.length, 'card', 'cards'),
          backFaces > 0 ? plural(backFaces, 'back face', 'back faces') : null,
          plural(pages.length, 'page', 'pages'),
        ]
          .filter(Boolean)
          .join(' · ');
  const hasSideboard = (deck.sideboard ?? []).length > 0;

  return (
    <div className="proxy-sheet">
      <BackLink to={`/decks/${deck.id}`} label={deck.name} />
      <PageHeader
        title="Print proxies"
        meta={summary}
        actions={[
          {
            label: 'Print',
            icon: Printer,
            primary: true,
            disabled: !ready,
            onClick: () => window.print(),
          },
        ]}
      />

      <div className="proxy-sheet-controls">
        {hasMissing && (
          <Field label="Cards">
            <SegmentedControl<ProxyScope>
              ariaLabel="Cards to print"
              value={scope}
              onChange={setScopeChoice}
              options={[
                { value: 'missing', label: `Missing · ${missingCards.length.toLocaleString()}` },
                { value: 'deck', label: `Whole deck · ${deckCards.length.toLocaleString()}` },
              ]}
            />
          </Field>
        )}
        <SwitchRow label="Skip basic lands" checked={skipBasics} onChange={setSkipBasics} />
        {hasSideboard && (
          <SwitchRow
            label="Include sideboard"
            checked={includeSideboard}
            onChange={setIncludeSideboard}
          />
        )}
        {tiles.length > 0 && (
          <p className="proxy-sheet-hint">
            Set the print scale to 100% so cards come out at real size.
          </p>
        )}
      </div>

      {tiles.length === 0 ? (
        slots.length === 0 ? (
          <EmptyState
            tagline="Nothing to print."
            hint="Add cards to this deck, then come back to print proxies."
            actions={<Button to={`/decks/${deck.id}`}>Back to deck</Button>}
          />
        ) : (
          <EmptyState
            tagline="Only basic lands to print."
            hint="Turn off Skip basic lands to print them."
            actions={<Button onClick={() => setSkipBasics(false)}>Include basic lands</Button>}
          />
        )
      ) : (
        <>
          {pending > 0 && (
            <div className="proxy-sheet-progress">
              <MeterBar
                value={loadedCount + failed.length}
                max={tiles.length}
                size="md"
                role="progressbar"
                label="Loading card images"
              />
              <p className="proxy-sheet-progress-text">
                Loading images · {loadedCount + failed.length} of {tiles.length}
              </p>
            </div>
          )}
          {failed.length > 0 && (
            <div className="discover-decks-error" role="alert">
              <span>
                {failed.length === 1
                  ? "1 image didn't load. It prints as a name-only card."
                  : `${failed.length} images didn't load. They print as name-only cards.`}
              </span>
              {retryable.length > 0 && (
                <Button onClick={() => retry(retryable)} className="discover-decks-error-retry">
                  Retry
                </Button>
              )}
            </div>
          )}
          <ol className="proxy-sheet-pages">
            {pages.map((page, p) => (
              <li
                key={p}
                className="proxy-sheet-page"
                aria-label={`Page ${p + 1} of ${pages.length}`}
              >
                <div className="proxy-sheet-grid">
                  {page.map((tile) => (
                    <ScreenTile key={tile.key} tile={tile} onStatus={mark} onRetry={retry} />
                  ))}
                </div>
              </li>
            ))}
          </ol>
          {createPortal(<PrintSheet pages={pages} />, document.body)}
        </>
      )}
    </div>
  );
}

function ScreenTile({
  tile,
  onStatus,
  onRetry,
}: {
  tile: SheetTile;
  onStatus: (src: string, next: ImageStatus) => void;
  onRetry: (urls: string[]) => void;
}) {
  const { src, status, name, imageUrl } = tile;
  const label = tile.back ? `${name}, back face` : name;
  return (
    <div className={status === 'loading' ? 'proxy-sheet-tile is-loading' : 'proxy-sheet-tile'}>
      {status === 'loading' && (
        <span className="deck-analysis-skeleton-bar proxy-sheet-tile-shimmer" aria-hidden="true" />
      )}
      {src && status !== 'failed' && (
        <img
          src={src}
          alt={label}
          decoding="async"
          // A cached image can finish before React attaches onLoad.
          ref={(img) => {
            if (img?.complete && img.naturalWidth > 0) onStatus(src, 'loaded');
          }}
          onLoad={() => onStatus(src, 'loaded')}
          onError={() => onStatus(src, 'failed')}
        />
      )}
      {status === 'failed' && (
        <div className="proxy-sheet-tile-failed">
          <span className="proxy-sheet-tile-name">{label}</span>
          {imageUrl ? (
            <Button
              onClick={() => onRetry([imageUrl])}
              icon={<RotateCw width={14} height={14} strokeWidth={1.8} />}
              aria-label={`Retry ${label}`}
            >
              Retry
            </Button>
          ) : (
            <span className="proxy-sheet-tile-note">No image</span>
          )}
        </div>
      )}
    </div>
  );
}

/** Crop-mark offsets: the grid's four column edges and four row edges. */
const EDGES = [0, 1, 2, 3];

/**
 * The full-size copy that actually prints. Hidden on screen; the screen
 * previews above it are what the player sees and acts on.
 */
function PrintSheet({ pages }: { pages: SheetTile[][] }) {
  return (
    <div className="proxy-print" aria-hidden="true">
      <style>{PAGE_RULE}</style>
      {pages.map((page, p) => (
        <section key={p} className="proxy-print-page">
          {EDGES.map((i) => (
            <span
              key={`v${i}`}
              className="proxy-print-tick is-col"
              style={{ '--edge': i } as CSSProperties}
            />
          ))}
          {EDGES.map((i) => (
            <span
              key={`h${i}`}
              className="proxy-print-tick is-row"
              style={{ '--edge': i } as CSSProperties}
            />
          ))}
          <div className="proxy-print-grid">
            {page.map((tile) =>
              tile.src && tile.status !== 'failed' ? (
                <img key={tile.key} className="proxy-print-card" src={tile.src} alt="" />
              ) : (
                <div key={tile.key} className="proxy-print-card proxy-print-blank">
                  {tile.name}
                </div>
              )
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
