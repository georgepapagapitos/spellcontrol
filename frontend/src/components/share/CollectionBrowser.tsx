import '@/styles/deck-builder-analysis.css';
import '@/styles/shared.css';
import { useState, type ReactNode } from 'react';
import { CardPreview, type CardPreviewAction } from '@/components/card/CardPreview';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/shared/Button';
import { useGridCaptionPrefs } from '@/components/shared/CardGridCell';
import { formatMoney } from '@/lib/collection/format-money';
import type { PublicCard } from '@/lib/social/shared-types';
import type { SharedSortKey } from '@/lib/social/shared-grouping';
import { SharedCardTile } from './SharedCardTile';
import { SharedCardList } from './SharedCardList';
import { CollectionBrowserToolbar } from './CollectionBrowserToolbar';
import { useCollectionBrowser, type BrowserGroup } from './use-collection-browser';
import './CollectionBrowser.css';

/**
 * Hook points a trading surface plugs into. A browser without `trade` shows no
 * "+" and no extra captions, which is every viewer but a friend about to trade.
 * Each hook is called per group, so keep them cheap.
 */
export interface CollectionBrowserTradeHooks {
  /** The "+" control in a tile's caption (and at the end of a list row). */
  renderAdd?: (group: BrowserGroup) => ReactNode;
  /** The tile's note line ("2 spare"). Null falls back to the default note. */
  caption?: (group: BrowserGroup) => string | null;
  /** A short plate on the art ("You want"). Spoken as well as shown. */
  flag?: (group: BrowserGroup) => string | null;
  /** How many of this card are in the trade; above 0 the tile shows it. */
  pickedCount?: (group: BrowserGroup) => number;
  /** Card preview extension points, indexed like the browser's sorted list. */
  preview?: {
    getActions?: (group: BrowserGroup) => CardPreviewAction[];
    renderPanelExtra?: (group: BrowserGroup) => ReactNode;
  };
}

export interface CollectionBrowserProps {
  /** One entry per physical copy. `null` until the data has arrived. */
  cards: PublicCard[] | null;
  /** The fetch failed: this message replaces the browser. */
  error?: string | null;
  onRetry?: () => void;
  /** A way out of the error state; defaults to the home page. */
  errorExit?: ReactNode;
  /** The owner keeps the collection private; `cards` is empty on purpose. */
  isPrivate?: boolean;
  /** Display name used in copy ("Morgan keeps their collection private."). */
  ownerName: string;
  /** "@handle" shown beside the name in the standalone header. */
  ownerHandle?: string | null;
  /** owner: your own profile tab. friend: an accepted friend. public: anyone
   *  else, including the owner on a bare share link. */
  viewer: 'owner' | 'friend' | 'public';
  /** Inside a page that already has its own heading and wrapper (a profile's
   *  Collection tab): drops the "Shared by" header and the `.shared-view`
   *  shell. */
  embedded?: boolean;
  /** Oracle ids the viewer wants; adds the "On my wants" chip. */
  myWants?: ReadonlySet<string>;
  /** The wants chip's label when the wants are not the viewer's own. */
  wantsLabel?: string;
  defaultSort?: SharedSortKey;
  /** A ranking only the caller knows, offered as a sort (see the hook). */
  priority?: { label: string; rank: (group: BrowserGroup) => number };
  /** How the search hint refers to these cards: "Morgan's" by default. */
  possessive?: string;
  /** The cards are this device's own, priced in the display currency, so the
   *  USD pin that server-stamped shares need would be wrong here. */
  localValues?: boolean;
  trade?: CollectionBrowserTradeHooks;
}

const SKELETON_TILES = 12;

/**
 * The one way to browse someone's collection: a profile's Collection tab, a
 * collection share link and (next) a friend's hub all render this, so a
 * friend browsing your cards gets the search, filters and sorts you have on
 * your own. See use-collection-browser.ts for the state; this is the markup
 * and the states (loading, error, private, empty, filtered to nothing).
 */
export function CollectionBrowser({
  cards,
  error,
  onRetry,
  errorExit,
  isPrivate,
  ownerName,
  ownerHandle,
  viewer,
  embedded = false,
  myWants,
  wantsLabel,
  defaultSort,
  priority,
  possessive: possessiveProp,
  localValues = false,
  trade,
}: CollectionBrowserProps) {
  const b = useCollectionBrowser({ cards, myWants, wantsLabel, defaultSort, priority });
  const possessive = possessiveProp ?? `${ownerName}'s`;
  const [captionPrefs, setCaptionPrefs] = useGridCaptionPrefs();
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const rootClass = embedded ? 'collection-browser is-embedded' : 'shared-view collection-browser';

  if (error) {
    return (
      <div className={rootClass}>
        <div role="alert">
          <EmptyState
            tagline="Couldn't load this collection."
            hint={error}
            actions={
              <>
                {onRetry && (
                  <Button variant="primary" onClick={onRetry}>
                    Retry
                  </Button>
                )}
                {errorExit ?? <Button to="/">Go to SpellControl</Button>}
              </>
            }
          />
        </div>
      </div>
    );
  }

  if (isPrivate) {
    return (
      <div className={rootClass}>
        <EmptyState tagline={`${ownerName} keeps their collection private.`} />
      </div>
    );
  }

  if (!b.hasData) {
    // Shaped like what is coming, with no count and no "empty" claim yet.
    return (
      <div className={rootClass} aria-busy="true" role="status" aria-label="Loading collection">
        <div className="collection-browser-skeleton-bar" aria-hidden="true" />
        <ul className="shared-card-grid collection-browser-skeleton" aria-hidden="true">
          {Array.from({ length: SKELETON_TILES }, (_, i) => (
            <li key={i} className="collection-browser-skeleton-tile" />
          ))}
        </ul>
      </div>
    );
  }

  if (b.totalCards === 0) {
    return (
      <div className={rootClass}>
        <EmptyState
          tagline={viewer === 'owner' ? 'Your collection is empty.' : 'This collection is empty.'}
        />
      </div>
    );
  }

  const resultLine = b.isFiltered ? (
    <>
      {b.matchedCopies.toLocaleString()} of {b.totalCards.toLocaleString()} cards
      <span aria-hidden="true"> · </span>
      <Button variant="link" className="collection-browser-clear" onClick={b.clearAll}>
        Clear all
      </Button>
    </>
  ) : (
    <>
      {b.totalCards.toLocaleString()} {b.totalCards === 1 ? 'card' : 'cards'}
      {b.totalValue > 0 && (
        <>
          {' · '}
          {/* Shared projections are server-stamped USD, so pin the symbol. */}
          {formatMoney(
            b.totalValue,
            localValues ? { wholeDollars: true } : { wholeDollars: true, currency: 'USD' }
          )}
        </>
      )}
    </>
  );

  return (
    <div className={rootClass}>
      {!embedded && (
        <header className="shared-view-header">
          <p className="shared-view-owner">
            Shared by {ownerName}
            {ownerHandle && <span className="shared-view-owner-handle">{ownerHandle}</span>}
          </p>
          <h1 className="shared-view-title">Collection</h1>
        </header>
      )}

      <CollectionBrowserToolbar
        possessive={possessive}
        query={b.query}
        onQueryChange={b.setQuery}
        filterNode={b.filterNode}
        sort={b.sort}
        dir={b.dir}
        onSort={b.toggleSort}
        hasPopularity={b.hasPopularity}
        priorityLabel={b.priorityLabel}
        view={b.view}
        onView={b.setView}
        chips={b.chips}
        onChip={b.toggleChip}
        captionPrefs={captionPrefs}
        onCaptionPrefs={setCaptionPrefs}
      />

      <p className="collection-browser-result" aria-live="polite">
        {resultLine}
      </p>

      {b.ignored.length > 0 && (
        <p className="collection-browser-note" role="status">
          {b.ignored.join(', ')} {b.ignored.length === 1 ? "isn't" : "aren't"} searchable in this
          collection. The rest of your search still ran.
        </p>
      )}

      {b.sorted.length === 0 ? (
        <EmptyState
          status
          tagline="No cards match."
          hint={
            b.query.trim()
              ? `Nothing in ${possessive} collection fits ${b.query.trim()} with these filters.`
              : `Nothing in ${possessive} collection fits these filters.`
          }
          actions={<Button onClick={b.clearAll}>Clear search and filters</Button>}
        />
      ) : (
        <>
          {b.view === 'grid' ? (
            <ul className="shared-card-grid">
              {b.shown.map((g, i) => (
                <li key={g.key}>
                  <SharedCardTile
                    card={g.card}
                    quantity={g.quantity}
                    spare={g.spare}
                    note={trade?.caption?.(g) ?? undefined}
                    flag={trade?.flag?.(g) ?? undefined}
                    pickedCount={trade?.pickedCount?.(g)}
                    action={trade?.renderAdd?.(g)}
                    localValues={localValues}
                    captionPrefs={captionPrefs}
                    onClick={() => setPreviewIndex(i)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <SharedCardList
              items={b.shown.map((g) => ({
                key: g.key,
                card: g.card,
                quantity: g.quantity,
                spare: g.spare,
                action: trade?.renderAdd?.(g),
              }))}
              onPreview={setPreviewIndex}
              table={b.view === 'compact'}
            />
          )}
          {b.hasMore && (
            <Button onClick={b.showMore} className="shared-collection-more">
              Show more ({b.remaining.toLocaleString()} left)
            </Button>
          )}
        </>
      )}

      {previewIndex !== null && b.previewCards[previewIndex] && (
        <CardPreview
          source="collection"
          theirCopy={viewer !== 'owner'}
          cards={b.previewCards}
          index={previewIndex}
          binderName="Collection"
          sectionLabels={b.previewLabels}
          pageNumbers={b.previewPages}
          totalPages={0}
          getStackQty={(i) => b.sorted[i]?.quantity ?? 1}
          getActions={
            trade?.preview?.getActions
              ? (i) => (b.sorted[i] ? trade.preview!.getActions!(b.sorted[i]) : [])
              : undefined
          }
          renderPanelExtra={
            trade?.preview?.renderPanelExtra
              ? (i) => (b.sorted[i] ? trade.preview!.renderPanelExtra!(b.sorted[i]) : null)
              : undefined
          }
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </div>
  );
}
