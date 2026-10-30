import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from 'react';
import { Search } from 'lucide-react';
import type { LegalityIssue } from '@/lib/deck/deck-validation';
import type { RoleKey } from '@/lib/deck-analysis/role-badges';
import type { DeckZone } from '../../store/decks';
import { CommanderOpenSlot } from './CommanderOpenSlot';
import { DeckCardGrid } from './DeckCardGrid';
import { hasCardActions, type DeckCardActionCtx } from './deck-card-actions';
import type { CurrencyCode, DeckViewMode, Row, ShowPrefs, TypedGroup } from './deck-display-rows';
import type { DeckDisplayProps } from './deck-display-types';

/** What the main deck and "Not in the deck" render with in common. */
export interface DeckBodyCtx {
  viewMode: DeckViewMode;
  currency: CurrencyCode;
  showPrefs: ShowPrefs;
  legalityBySlot: Map<string, LegalityIssue>;
  gridZoom: number;
  gridWidth: number;
  synergyByName: Map<string, string[]>;
  binderByCopyId: DeckDisplayProps['binderByCopyId'];
  /** Hover + touch peek handlers for a list container. */
  listHandlers: HTMLAttributes<HTMLElement>;
  openPreview: (rowName: string, slotId?: string) => void;
  openCardMenu: (zone: DeckZone) => (row: Row, e: React.MouseEvent) => void;
  openCardMenuAt: (zone: DeckZone) => (row: Row, trigger: HTMLElement) => void;
  cardMenuCtx: (row: Row, zone: DeckZone) => DeckCardActionCtx;
}

/** The mainboard: a list of columns, or tiles/stacks. */
export function DeckMainSection({
  ctx,
  groups,
  chooseCommander,
  listRef,
  listCols,
  commandGroups,
  listColumns,
  renderListSection,
  collapsedTitles,
  onToggleSection,
  gridRef,
  roleFilter,
  hasPartner,
  onEditPartner,
}: {
  ctx: DeckBodyCtx;
  groups: TypedGroup[];
  chooseCommander: (() => void) | undefined;
  listRef: Ref<HTMLDivElement>;
  listCols: number;
  commandGroups: TypedGroup[];
  listColumns: TypedGroup[][];
  renderListSection: (g: TypedGroup) => ReactNode;
  collapsedTitles: Set<string>;
  onToggleSection: (title: string) => void;
  gridRef: (el: HTMLElement | null) => void;
  roleFilter: RoleKey | null;
  hasPartner: boolean;
  onEditPartner: DeckDisplayProps['onEditPartner'];
}) {
  if (groups.length === 0) return null;
  if (ctx.viewMode === 'list') {
    return (
      <div
        className="deck-card-list"
        ref={listRef}
        style={{ '--deck-cols': listCols } as CSSProperties}
        {...ctx.listHandlers}
      >
        {/* Command zone — the commander (and partner) as a full-width
        strip ABOVE the type columns, rendered with the same
        CategorySection/DeckMainboardRow as every other card so the
        interactions are identical. It never occupies a column: a
        1-row section at the top of a column stranded a 30-row hole
        under it. Its rows align to the column grid below. */}
        {commandGroups.length > 0 ? (
          <div className="deck-command-zone">{commandGroups.map(renderListSection)}</div>
        ) : (
          chooseCommander && <CommanderOpenSlot onChoose={chooseCommander} />
        )}
        <div className="deck-card-columns">
          {listColumns.map((column, i) => (
            <div key={i} className="deck-card-column">
              {column.map(renderListSection)}
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <>
      {/* Grid and stacks have no command-zone strip of their own (the
        commander is a group among the tiles), so the open slot leads them
        the same way it leads the list: no view is left without a way in. */}
      {chooseCommander && <CommanderOpenSlot onChoose={chooseCommander} />}
      <DeckCardGrid
        layout={ctx.viewMode}
        groups={groups}
        currency={ctx.currency}
        showPrice={ctx.showPrefs.price}
        collapsedTitles={collapsedTitles}
        onToggleSection={onToggleSection}
        onRowContextMenu={ctx.openCardMenu('cards')}
        onRowMenu={ctx.openCardMenuAt('cards')}
        rowHasMenu={(row) => hasCardActions(ctx.cardMenuCtx(row, 'cards'))}
        onRowClick={ctx.openPreview}
        legalityBySlot={ctx.legalityBySlot}
        gridZoom={ctx.gridZoom}
        gridRef={gridRef}
        gridWidth={ctx.gridWidth}
        showRoles={ctx.showPrefs.roles}
        roleFilter={roleFilter}
        synergyByName={ctx.synergyByName}
        binderByCopyId={ctx.binderByCopyId}
        hasPartner={hasPartner}
        onEditPartner={onEditPartner}
      />
    </>
  );
}

/**
 * "Not in the deck" (E176): Sideboard and Considering as two more sections at
 * the foot of the deck, drawn by the same renderer the deck uses in the
 * current view (tiles, stacks or rows) with the same header, so they read as
 * more of the deck rather than a form under it. The Sideboard is
 * format-gated; Considering (E122) is always here. Neither feeds stats,
 * legality, mana or role counts. Always mounted, even at 0/0: they are where
 * "Move to sideboard" and "Move to considering" land, and the target of the
 * page hero's "+N sideboard" link.
 */
export function DeckOutzone({
  ctx,
  groups,
  listCols,
  collapsedTitles,
  onToggleSection,
  zoneOf,
  renderSection,
}: {
  ctx: DeckBodyCtx;
  groups: TypedGroup[];
  listCols: number;
  collapsedTitles: Set<string>;
  onToggleSection: (title: string) => void;
  /** A tile's menu needs its pile; the grid reports only the row. */
  zoneOf: (row: Row) => DeckZone;
  renderSection: (g: TypedGroup) => ReactNode;
}) {
  return (
    <section className="deck-outzone" id="deck-outzone" tabIndex={-1} aria-label="Not in the deck">
      {ctx.viewMode === 'list' ? (
        // The deck's own column grid, so a pile is exactly as wide as a column
        // above it.
        <div
          className="deck-card-columns"
          style={{ '--deck-cols': listCols } as CSSProperties}
          {...ctx.listHandlers}
        >
          {groups.map((g) => (
            <div key={g.title} className="deck-card-column">
              {renderSection(g)}
            </div>
          ))}
        </div>
      ) : (
        <DeckCardGrid
          layout={ctx.viewMode}
          groups={groups}
          currency={ctx.currency}
          showPrice={ctx.showPrefs.price}
          collapsedTitles={collapsedTitles}
          onToggleSection={onToggleSection}
          onRowContextMenu={(row, e) => ctx.openCardMenu(zoneOf(row))(row, e)}
          onRowMenu={(row, trigger) => ctx.openCardMenuAt(zoneOf(row))(row, trigger)}
          rowHasMenu={(row) => hasCardActions(ctx.cardMenuCtx(row, zoneOf(row)))}
          onRowClick={ctx.openPreview}
          legalityBySlot={ctx.legalityBySlot}
          gridZoom={ctx.gridZoom}
          gridWidth={ctx.gridWidth}
          showRoles={ctx.showPrefs.roles}
          synergyByName={ctx.synergyByName}
          binderByCopyId={ctx.binderByCopyId}
        />
      )}
    </section>
  );
}

/** Offered when a search matches nothing in the deck: look the card up to add it. */
export function ScryfallSearchTrigger({
  query,
  onSearch,
}: {
  query: string;
  onSearch: (query: string) => void;
}) {
  return (
    <button
      type="button"
      className="deck-display-scryfall-trigger"
      onClick={() => onSearch(query)}
      aria-label={`Search Scryfall for ${query} to add a card not in this deck`}
    >
      <Search width={16} height={16} strokeWidth={1.8} aria-hidden />
      <span className="deck-display-scryfall-trigger-text">
        <span className="deck-display-scryfall-trigger-title">Search Scryfall</span>
        <span className="deck-display-scryfall-trigger-sub">
          for &ldquo;{query}&rdquo;, add a card not in this deck
        </span>
      </span>
    </button>
  );
}
