import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Navigate, useParams } from 'react-router-dom';
import { Printer, RotateCw } from 'lucide-react';
import { BackLink } from '@/components/app-shell/BackLink';
import { PageHeader } from '@/components/app-shell/PageHeader';
import { Button } from '@/components/shared/Button';
import { EmptyState } from '@/components/shared/EmptyState';
import { MeterBar } from '@/components/shared/MeterBar';
import { SelectMenu } from '@/components/overlays/SelectMenu';
import { Field, SegmentedControl, SwitchRow } from '@/components/shared/form';
import { useCollectionByCopyId } from '@/lib/collection/allocations';
import { useAwaitingFirstPull } from '@/lib/sync/use-awaiting-first-pull';
import { useDocumentTitle } from '@/lib/util/use-document-title';
import {
  buildProxyTiles,
  chunkPages,
  proxySlots,
  retryUrl,
  selectProxyCards,
  type ProxyScope,
  type ProxyTile,
} from '@/lib/collection/proxy-sheet';
import {
  CARD_CORNER_PATH,
  GAPS_MM,
  PAGE_MARGIN_MM,
  PAPERS,
  SCALES,
  decklistSections,
  fullPageScale,
  readSettings,
  sheetLayout,
  writeSettings,
  type DecklistSection,
  type PaperId,
  type PrintSettings,
  type SheetLayout,
} from '@/lib/collection/proxy-layout';
import { useDecksStore } from '@/store/decks';
import './ProxySheetPage.css';

type ImageStatus = 'loaded' | 'failed';

/** A tile as rendered: the URL to load now (after any retries) and its state. */
interface SheetTile extends ProxyTile {
  src: string | undefined;
  status: ImageStatus | 'loading';
}

/** A unitless number as a CSS custom property, scaled by `--u` where it's used. */
type Vars = CSSProperties & Record<`--${string}`, number>;

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
  const [settings, setSettings] = useState(() => readSettings(navigator.language));
  const [includeSideboard, setIncludeSideboard] = useState(false);
  // Keyed by the card's own image URL: every copy of a card shares one load.
  const [attempts, setAttempts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<Record<string, ImageStatus>>({});

  const update = useCallback(
    <K extends keyof PrintSettings>(key: K, value: PrintSettings[K]) =>
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        writeSettings(next);
        return next;
      }),
    []
  );
  const { skipBasics, paper, gap, scale, cropMarks, bleed } = settings;
  const layout = useMemo(
    () => sheetLayout({ paper, gap, scale, cropMarks, bleed }),
    [paper, gap, scale, cropMarks, bleed]
  );
  const betterScale = useMemo(
    () => fullPageScale({ paper, gap, scale, cropMarks, bleed }),
    [paper, gap, scale, cropMarks, bleed]
  );

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
  const pages = useMemo(() => chunkPages(tiles, layout.perPage), [tiles, layout.perPage]);
  const decklist = useMemo(
    () => (deck && settings.decklist ? decklistSections(deck, includeSideboard) : []),
    [deck, settings.decklist, includeSideboard]
  );

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
          plural(pages.length + (decklist.length > 0 ? 1 : 0), 'page', 'pages'),
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
        <div className="proxy-sheet-fields">
          <Field label="Paper">
            <SelectMenu<PaperId>
              ariaLabel="Paper"
              value={paper}
              onChange={(v) => update('paper', v)}
              options={(Object.keys(PAPERS) as PaperId[]).map((id) => ({
                value: id,
                label: PAPERS[id].label,
              }))}
            />
          </Field>
          <Field label="Gap">
            <SegmentedControl<number>
              ariaLabel="Gap between cards"
              value={gap}
              onChange={(v) => update('gap', v)}
              options={GAPS_MM.map((mm) => ({
                value: mm,
                label: mm === 0 ? 'None' : `${mm} mm`,
              }))}
            />
          </Field>
          <Field label="Scale">
            <SelectMenu<number>
              ariaLabel="Scale"
              value={scale}
              onChange={(v) => update('scale', v)}
              options={SCALES.map((pct) => ({
                value: pct,
                label: `${pct}%`,
                itemLabel: pct === 100 ? '100% · real size' : `${pct}%`,
              }))}
            />
          </Field>
        </div>
        {betterScale !== undefined && (
          <p className="proxy-sheet-hint" role="status">
            {plural(layout.perPage, 'card fits', 'cards fit')} a page with these settings. At{' '}
            {betterScale}% scale, {fullPerPage(settings)} fit.
          </p>
        )}
        <div className="proxy-sheet-switches">
          <SwitchRow
            label="Skip basic lands"
            checked={skipBasics}
            onChange={(v) => update('skipBasics', v)}
          />
          {hasSideboard && (
            <SwitchRow
              label="Include sideboard"
              checked={includeSideboard}
              onChange={setIncludeSideboard}
            />
          )}
          <SwitchRow
            label="Crop marks"
            hint="Lines in the margins to cut along."
            checked={cropMarks}
            onChange={(v) => update('cropMarks', v)}
          />
          <SwitchRow
            label="Black corners"
            hint="Fills each card's rounded corners in black."
            checked={settings.blackCorners}
            onChange={(v) => update('blackCorners', v)}
          />
          <SwitchRow
            label="Bleed"
            hint="A 1 mm black edge around each card, so a cut that drifts shows no white."
            checked={bleed}
            onChange={(v) => update('bleed', v)}
          />
          <SwitchRow
            label="Playtest watermark"
            hint="Marks each card as a playtest card."
            checked={settings.watermark}
            onChange={(v) => update('watermark', v)}
          />
          <SwitchRow
            label="Print decklist"
            hint="Adds a page that lists the deck."
            checked={settings.decklist}
            onChange={(v) => update('decklist', v)}
          />
        </div>
        {tiles.length > 0 && (
          <p className="proxy-sheet-hint">
            In the print dialog, set the scale to 100% so cards come out at the size set here.
            Choose Save as PDF there to keep a copy.
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
            actions={
              <Button onClick={() => update('skipBasics', false)}>Include basic lands</Button>
            }
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
                style={paperVars(layout)}
                aria-label={`Page ${p + 1} of ${pages.length}`}
              >
                <CardSheet
                  layout={layout}
                  settings={settings}
                  tiles={page}
                  renderCard={(tile) => <ScreenTile tile={tile} onStatus={mark} onRetry={retry} />}
                />
              </li>
            ))}
            {decklist.length > 0 && (
              <li className="proxy-sheet-page" style={paperVars(layout)} aria-label="Decklist page">
                <Decklist name={deck.name} sections={decklist} layout={layout} />
              </li>
            )}
          </ol>
          {createPortal(
            <PrintSheet
              pages={pages}
              layout={layout}
              settings={settings}
              deckName={deck.name}
              decklist={decklist}
            />,
            document.body
          )}
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

const fullPerPage = (settings: PrintSettings) =>
  sheetLayout({ ...settings, scale: 100, gap: 0, bleed: false }).perPage;

/** The paper's size, for the screen preview's proportions and its mm unit. */
const paperVars = (layout: SheetLayout): Vars => ({
  '--paper-w': layout.paper.width,
  '--paper-h': layout.paper.height,
  '--margin': PAGE_MARGIN_MM,
});

/**
 * One page of cards, laid out in millimetres scaled by `--u`: 1 mm on paper,
 * a fraction of the preview's width on screen. Crop marks sit under the cards,
 * so only the part in the margins and gaps shows.
 */
function CardSheet({
  layout,
  settings,
  tiles,
  renderCard,
  className = 'proxy-layout',
}: {
  layout: SheetLayout;
  settings: PrintSettings;
  tiles: SheetTile[];
  renderCard: (tile: SheetTile) => ReactNode;
  className?: string;
}) {
  const vars: Vars = {
    '--w': layout.width,
    '--h': layout.height,
    '--cw': layout.card.width,
    '--ch': layout.card.height,
    '--bleed': layout.bleed,
  };
  // A part-filled page cuts only the rows it uses: the vertical cuts stop the
  // same mark-room below its last row as below a full page's.
  const { cells, card, cols } = layout;
  const lastRowBottom = cells[(Math.ceil(tiles.length / cols) - 1) * cols].y + card.height;
  const markBelow = layout.height - cells[cells.length - 1].y - card.height;
  const cutsY = layout.cutsY.filter((at) => at <= lastRowBottom + 1e-6);
  return (
    <div className={className} style={vars}>
      {settings.cropMarks &&
        layout.cutsX.map((at) => (
          <span
            key={`x${at}`}
            className="proxy-cut is-x"
            style={{ '--at': at, '--end': lastRowBottom + markBelow } as Vars}
          />
        ))}
      {settings.cropMarks &&
        cutsY.map((at) => (
          <span key={`y${at}`} className="proxy-cut is-y" style={{ '--at': at } as Vars} />
        ))}
      {tiles.map((tile, i) => (
        <div
          key={tile.key}
          className="proxy-cell"
          style={{ '--x': layout.cells[i].x, '--y': layout.cells[i].y } as Vars}
        >
          {layout.bleed > 0 && <span className="proxy-bleed" aria-hidden="true" />}
          {renderCard(tile)}
          {settings.blackCorners && (
            <svg
              className="proxy-corners"
              viewBox="0 0 63 88"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path d={CARD_CORNER_PATH} fillRule="evenodd" />
            </svg>
          )}
          {settings.watermark && (
            <span className="proxy-watermark" aria-hidden="true">
              Playtest card
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function Decklist({
  name,
  sections,
  layout,
}: {
  name: string;
  sections: DecklistSection[];
  layout: SheetLayout;
}) {
  return (
    <div className="proxy-decklist" style={{ '--dw': layout.printableWidth } as Vars}>
      <h2 className="proxy-decklist-title">{name}</h2>
      {sections.map((section) => (
        <section key={section.title} className="proxy-decklist-section">
          <h3>
            {section.title} · {section.lines.reduce((n, line) => n + line.qty, 0)}
          </h3>
          <ul>
            {section.lines.map((line) => (
              <li key={line.name}>
                {line.qty} {line.name}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * The full-size copy that actually prints. Hidden on screen; the screen
 * previews above it are what the player sees and acts on. The `@page` rule
 * lives here, not in the stylesheet, so it unmounts with the page: a lazy
 * chunk's CSS stays in the document after navigating away and would change
 * every later print.
 */
function PrintSheet({
  pages,
  layout,
  settings,
  deckName,
  decklist,
}: {
  pages: SheetTile[][];
  layout: SheetLayout;
  settings: PrintSettings;
  deckName: string;
  decklist: DecklistSection[];
}) {
  const { width, height } = layout.paper;
  return (
    <div className="proxy-print" aria-hidden="true">
      <style>{`@page { size: ${width}mm ${height}mm; margin: ${PAGE_MARGIN_MM}mm; }`}</style>
      {pages.map((page, p) => (
        <CardSheet
          key={p}
          className="proxy-layout proxy-print-page"
          layout={layout}
          settings={settings}
          tiles={page}
          renderCard={(tile) =>
            tile.src && tile.status !== 'failed' ? (
              <img className="proxy-print-card" src={tile.src} alt="" />
            ) : (
              <div className="proxy-print-card proxy-print-blank">{tile.name}</div>
            )
          }
        />
      ))}
      {decklist.length > 0 && (
        <div className="proxy-print-page proxy-print-decklist">
          <Decklist name={deckName} sections={decklist} layout={layout} />
        </div>
      )}
    </div>
  );
}
