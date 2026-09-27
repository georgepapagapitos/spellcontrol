import { ChevronRight, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { useCubeStore } from '../store/cube';
import { useAllocations } from '../lib/allocations';
import { summarizeCostBasis } from '../lib/cost-basis';
import { useCurrency } from '../lib/currency';
import { formatMoney } from '../lib/format-money';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useSheetExit } from '../lib/use-sheet-exit';
import { useEscapeKey } from '../lib/use-escape-key';
import type { BinderDef, EnrichedCard } from '../types';
import { ColorPip, ManaSymbol, TypeIcon } from './shared/ManaSymbol';
import { MeterBar, StackedBar } from './shared/MeterBar';
import { ValueTrend } from './ValueTrend';
import { IconButton, Button } from '@/components/shared/Button';
import { SelectMenu } from './SelectMenu';
import { SegmentedControl } from './shared/form';
import { EmptyState } from './shared/EmptyState';
import {
  computeAllocationSplit,
  computeSparesSummary,
  computeSharedCopies,
  computeCloseToDone,
  computeConcentration,
  computeGroupedBreakdown,
  BREAKDOWN_GROUP_OPTIONS,
  COLOR_BUCKETS,
  type BreakdownGroupBy,
  type BreakdownMeasure,
  type CollectionFilterJump,
  type GroupedBreakdownRow,
  type SharedCopyRow,
  type CloseToDoneRow,
} from '../lib/collection-insights';

interface Props {
  open: boolean;
  onClose: () => void;
  /** A row asked to filter the collection table to a dimension this drawer
   *  just computed (a surplus toggle, a color/type/rarity/set/binder bucket).
   *  Owned by CollectionPage, which forwards it to CardListTable's
   *  `filterJump` prop — see that prop's doc for why this isn't a URL param. */
  onFilterJump: (jump: CollectionFilterJump) => void;
}

export function StatsBar({ open, onClose, onFilterJump }: Props) {
  const cards = useCollectionStore((s) => s.cards);
  const scryfallMisses = useCollectionStore((s) => s.scryfallMisses);
  const binderDefs = useCollectionStore((s) => s.binders);

  // True if any rule references the post-v1 filter fields (legalities /
  // oracle / layouts / finishes / manaCost).
  const usesNewFilters = binderDefs.some((b) =>
    (b.filterGroups || []).some((g) => {
      const f = g.filter || {};
      return (
        (f.legalities?.chips.length ?? 0) > 0 ||
        (f.oracleChips?.chips.length ?? 0) > 0 ||
        (f.layouts?.chips.length ?? 0) > 0 ||
        (f.finishes?.chips.length ?? 0) > 0 ||
        f.manaCost
      );
    })
  );
  const cardsLackNewFields = cards.length > 0 && !cards.some((c) => c.legalities !== undefined);
  const showStaleBanner = usesNewFilters && cardsLackNewFields;

  return (
    <>
      {showStaleBanner && (
        <div className="warn-banner">
          Some cards are missing newer Scryfall fields. Re-import your collection to filter by
          format, oracle text, layout, or finish.
        </div>
      )}
      {scryfallMisses > 0 && (
        <div className="warn-banner">
          {scryfallMisses} card{scryfallMisses !== 1 ? 's' : ''} couldn't be enriched with Scryfall
          data. Color, mana value, and type sorting may be inaccurate for them.
        </div>
      )}

      {open && (
        <StatsDrawer
          cards={cards}
          binderDefs={binderDefs}
          onClose={onClose}
          onFilterJump={onFilterJump}
        />
      )}
    </>
  );
}

/**
 * Cost basis vs current market value (E203) — "how did my money do", the
 * companion to ValueTrend's "what is it worth now".
 *
 * Deliberately scoped to copies with a recorded price on both sides, and always
 * printed WITH that coverage: a collection where 300 of 8,000 copies have a
 * price cannot report a collection-wide gain, and treating the other 7,700 as
 * free would turn their entire market value into fake profit.
 *
 * Renders nothing when nothing is covered — a user who has never recorded a
 * price gets no empty state here; the "Paid" field in the card edit dialog is
 * where the feature is discovered.
 */
function CostBasisCard({ cards }: { cards: EnrichedCard[] }) {
  const currency = useCurrency();
  const summary = useMemo(() => summarizeCostBasis(cards, currency), [cards, currency]);
  if (summary.covered === 0) return null;

  const gain = Math.round(summary.gain);
  const pct = Math.round((summary.gain / summary.basis) * 100);
  const direction = gain > 0 ? 'up' : gain < 0 ? 'down' : 'flat';
  // Mirrors STYLE_GUIDE's money-delta rule (as ValueTrend does): a zero delta
  // reads as "Even", never "+$0".
  const headline =
    gain === 0
      ? 'Even with what you paid'
      : `${gain > 0 ? '+' : '−'}${formatMoney(Math.abs(gain), { wholeDollars: true })} (${gain > 0 ? '+' : '−'}${Math.abs(pct)}%)`;

  return (
    <section className="breakdown-card cost-basis" aria-label="Cost basis">
      <h3 className="breakdown-title">Cost basis</h3>
      <p className="cost-basis-headline">
        <span className={`cost-basis-gain cost-basis-gain--${direction}`}>{headline}</span>
        <span className="cost-basis-sub">
          {summary.covered.toLocaleString()} of {summary.total.toLocaleString()} copies with a
          recorded price
        </span>
      </p>
      <dl className="cost-basis-pair">
        <div className="cost-basis-pair-item">
          <dt>Paid</dt>
          <dd>{formatMoney(summary.basis)}</dd>
        </div>
        <div className="cost-basis-pair-item">
          <dt>Now worth</dt>
          <dd>{formatMoney(summary.market)}</dd>
        </div>
      </dl>
    </section>
  );
}

// ── Insight row primitive (STYLE_GUIDE "Index-page insight strips" /
// memory feedback_insight_surfaces_never_displace_content, generalized from
// the ownership-lens strip to any drawer row): count + teaser + chevron when
// there's an action, a plain line when there isn't. Never rendered for an
// insight with nothing to say — each call site's own null-guard above this.

interface InsightRowProps {
  label: string;
  detail: string;
  onClick?: () => void;
  to?: string;
  /** A thin value/share bar under the text — only "In decks vs idle" carries
   *  one today. Renders in both the button and static row shapes. */
  bar?: ReactNode;
}

function InsightRow({ label, detail, onClick, to, bar }: InsightRowProps) {
  const text = (
    <span className="collection-insight-row-text">
      <span className="collection-insight-row-label">{label}</span>
      <span className="collection-insight-row-detail">{detail}</span>
      {bar}
    </span>
  );

  if (to) {
    return (
      <Link to={to} className="collection-insight-row">
        {text}
        <ChevronRight
          className="collection-insight-row-chevron"
          aria-hidden
          width={16}
          height={16}
        />
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" className="collection-insight-row" onClick={onClick}>
        {text}
        <ChevronRight
          className="collection-insight-row-chevron"
          aria-hidden
          width={16}
          height={16}
        />
      </button>
    );
  }
  return <div className="collection-insight-row collection-insight-row--static">{text}</div>;
}

function sharedCopyDetail(row: SharedCopyRow): string {
  const deckCount = row.wantedBy.filter((w) => w.kind === 'deck').length;
  const cubeCount = row.wantedBy.filter((w) => w.kind === 'cube').length;
  const phrase =
    cubeCount === 0
      ? `in ${deckCount} deck${deckCount === 1 ? '' : 's'}`
      : deckCount === 0
        ? `in ${cubeCount} cube${cubeCount === 1 ? '' : 's'}`
        : `in ${deckCount} deck${deckCount === 1 ? '' : 's'} and ${cubeCount} cube${cubeCount === 1 ? '' : 's'}`;
  return `${row.cardName}: ${phrase}, you own ${row.owned}.`;
}

function closeToDoneDetail(row: CloseToDoneRow): string {
  const count = row.missingNames.length;
  const costText =
    row.costToFinish > 0
      ? ` · ${formatMoney(row.costToFinish, { wholeDollars: true })} to finish`
      : '';
  return `${row.deckName}: missing ${count} card${count === 1 ? '' : 's'}${costText}.`;
}

/**
 * Cards where decks/cubes together want more copies than you own (T164) —
 * the drawer's own list sheet when the top-level insight row covers more
 * than one card, mirroring `OwnershipLensSheet`'s "card-picker" shell
 * (`components/deck/OwnershipLensSheet.tsx`) verbatim, so this file needs no
 * CSS of its own beyond the insight rows.
 */
function SharedCopiesSheet({ rows, onClose }: { rows: SharedCopyRow[]; onClose: () => void }) {
  useLockBodyScroll();
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  const dismiss = () => beginClose();
  useEscapeKey(dismiss);

  return (
    <div
      className="card-picker-root"
      role="presentation"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        className={`card-picker-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Cards wanted by more decks than you own"
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">Shared copies</h2>
        </div>
        <ul className="card-picker-list" role="list" aria-label="Cards in shortfall">
          {rows.map((row) => (
            <li key={row.cardName} className="card-picker-row">
              <span className="card-picker-name">{row.cardName}</span>
              <span className="card-picker-meta">
                {row.wantedBy.map((w, i) => (
                  <span key={`${w.kind}-${w.id}`}>
                    {i > 0 && ', '}
                    {w.kind === 'deck' ? <Link to={`/decks/${w.id}`}>{w.name}</Link> : w.name}
                  </span>
                ))}
                {' · you own '}
                {row.owned}
              </span>
            </li>
          ))}
        </ul>
        <div className="card-picker-footer">
          <Button variant="primary" onClick={dismiss}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Decks missing 1-5 unowned cards (T164) — same card-picker shell as
 *  `SharedCopiesSheet`, listing decks instead of cards. */
function CloseToDoneSheet({ rows, onClose }: { rows: CloseToDoneRow[]; onClose: () => void }) {
  useLockBodyScroll();
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  const dismiss = () => beginClose();
  useEscapeKey(dismiss);

  return (
    <div
      className="card-picker-root"
      role="presentation"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        className={`card-picker-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Decks close to done"
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">Close to done</h2>
        </div>
        <ul className="card-picker-list" role="list" aria-label="Decks missing a few cards">
          {rows.map((row) => (
            <li key={row.deckId} className="card-picker-row">
              <Link to={`/decks/${row.deckId}`} className="card-picker-name">
                {row.deckName}
              </Link>
              <span className="card-picker-meta">
                Missing {row.missingNames.length}
                {row.costToFinish > 0
                  ? ` · ${formatMoney(row.costToFinish, { wholeDollars: true })}`
                  : ''}
              </span>
            </li>
          ))}
        </ul>
        <div className="card-picker-footer">
          <Button variant="primary" onClick={dismiss}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Grouped Breakdown card (Color / Type / Rarity / Set / Binder / Deck use) ─

const GROUP_BY_KEY = 'spellcontrol:collection-breakdown-group';
const MEASURE_KEY = 'spellcontrol:collection-breakdown-measure';
const SET_ROW_CAP = 8;

function loadGroupBy(): BreakdownGroupBy {
  try {
    const v = localStorage.getItem(GROUP_BY_KEY);
    if (BREAKDOWN_GROUP_OPTIONS.some((o) => o.value === v)) return v as BreakdownGroupBy;
  } catch {
    /* private browsing / blocked storage */
  }
  return 'color';
}

function loadMeasure(): BreakdownMeasure {
  try {
    const v = localStorage.getItem(MEASURE_KEY);
    if (v === 'count' || v === 'value') return v;
  } catch {
    /* private browsing / blocked storage */
  }
  return 'count';
}

/** The dimension-specific glyph the old fixed Colors/Types/Rarity sections
 *  each carried, kept for the three dimensions that had one. Set/Binder/Deck
 *  use never had a glyph and don't get one now. */
function breakdownRowIcon(groupBy: BreakdownGroupBy, row: GroupedBreakdownRow) {
  if (groupBy === 'color') return <ColorPip color={row.key} />;
  if (groupBy === 'rarity') {
    return (
      <ManaSymbol
        symbol="planeswalker"
        className={`breakdown-icon breakdown-icon-rarity rarity-${row.key}`}
      />
    );
  }
  if (groupBy === 'type' && row.key !== 'other') {
    return <TypeIcon type={row.key} className="breakdown-icon" />;
  }
  return null;
}

interface BreakdownRowProps {
  row: GroupedBreakdownRow;
  groupBy: BreakdownGroupBy;
  measure: BreakdownMeasure;
  total: number;
  typeCountTotal: number;
  onSelect?: () => void;
}

function BreakdownRow({
  row,
  groupBy,
  measure,
  total,
  typeCountTotal,
  onSelect,
}: BreakdownRowProps) {
  const measureValue = measure === 'count' ? row.count : row.value;
  const pct = total > 0 ? Math.round((measureValue / total) * 100) : 0;
  const displayValue =
    measure === 'count'
      ? row.count.toLocaleString()
      : formatMoney(row.value, { wholeDollars: true });
  const icon = breakdownRowIcon(groupBy, row);

  const body = (
    <>
      <div className="breakdown-row-head">
        {icon}
        <span className="breakdown-row-label">{row.label}</span>
        <span className="breakdown-row-count">{displayValue}</span>
        <span className="breakdown-row-pct">({pct}%)</span>
      </div>
      {row.colorSplits ? (
        <StackedBar
          max={typeCountTotal}
          segments={COLOR_BUCKETS.map((b) => ({
            key: b.key,
            value: row.colorSplits![b.key] ?? 0,
            color: b.color,
            title: `${b.label}: ${row.colorSplits![b.key] ?? 0}`,
          }))}
        />
      ) : (
        <MeterBar value={measureValue} max={total} color={row.color} />
      )}
    </>
  );

  if (!onSelect) {
    return <li className="breakdown-row">{body}</li>;
  }
  return (
    <li className="breakdown-row breakdown-row--interactive">
      <button type="button" className="breakdown-row-button" onClick={onSelect}>
        {body}
      </button>
    </li>
  );
}

/**
 * The drawer itself, split out so it mounts fresh on every open — that
 * replays the entry slide and resets useSheetExit's closing state (the
 * hook is one-shot; it must unmount with the drawer, not live in the
 * always-mounted StatsBar shell).
 */
function StatsDrawer({
  cards,
  binderDefs,
  onClose,
  onFilterJump,
}: {
  cards: EnrichedCard[];
  binderDefs: BinderDef[];
  onClose: () => void;
  onFilterJump: (jump: CollectionFilterJump) => void;
}) {
  useLockBodyScroll();

  // Symmetric slide-out exit (side drawer: in from the right, back out to
  // the right) so every dismiss path — backdrop, ✕, Escape — plays
  // `stats-drawer-slide-out` before unmount instead of vanishing.
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'stats-drawer-slide-out');

  const decks = useDecksStore((s) => s.decks);
  const cubes = useCubeStore((s) => s.saved);
  const allocations = useAllocations();
  const currency = useCurrency();

  // Applies a row's filter to the collection table (via the CollectionPage
  // callback -> CardListTable's filterJump prop) and closes the drawer the
  // same way any other dismiss does.
  const closeAndJump = (jump: CollectionFilterJump) => {
    onFilterJump(jump);
    beginClose();
  };

  const allocationSplit = useMemo(
    () => computeAllocationSplit(cards, allocations),
    [cards, allocations]
  );
  const sparesSummary = useMemo(
    () => computeSparesSummary(cards, allocations),
    [cards, allocations]
  );
  const sharedCopyRows = useMemo(
    () => computeSharedCopies(cards, decks, cubes),
    [cards, decks, cubes]
  );
  const ownedNames = useMemo(() => new Set(cards.map((c) => c.name)), [cards]);
  const closeToDoneRows = useMemo(
    () => computeCloseToDone(decks, ownedNames, currency),
    [decks, ownedNames, currency]
  );
  const concentration = useMemo(() => computeConcentration(cards), [cards]);
  const hasInsights =
    allocationSplit ||
    sparesSummary ||
    sharedCopyRows.length > 0 ||
    closeToDoneRows.length > 0 ||
    concentration;

  const [sharedCopiesSheetOpen, setSharedCopiesSheetOpen] = useState(false);
  const [closeToDoneSheetOpen, setCloseToDoneSheetOpen] = useState(false);

  const [groupBy, setGroupByState] = useState<BreakdownGroupBy>(loadGroupBy);
  const setGroupBy = (v: BreakdownGroupBy) => {
    setGroupByState(v);
    try {
      localStorage.setItem(GROUP_BY_KEY, v);
    } catch {
      /* private browsing / blocked storage */
    }
  };
  const [measure, setMeasureState] = useState<BreakdownMeasure>(loadMeasure);
  const setMeasure = (v: BreakdownMeasure) => {
    setMeasureState(v);
    try {
      localStorage.setItem(MEASURE_KEY, v);
    } catch {
      /* private browsing / blocked storage */
    }
  };
  const [showAllSets, setShowAllSets] = useState(false);
  // Reset the cap when the group-by dimension changes. Adjusted during
  // render (React's documented pattern for "state depending on a changed
  // prop") rather than in an effect, which would set state synchronously
  // in the effect body and trigger a cascading extra render.
  const [showAllSetsForGroup, setShowAllSetsForGroup] = useState(groupBy);
  if (showAllSetsForGroup !== groupBy) {
    setShowAllSetsForGroup(groupBy);
    setShowAllSets(false);
  }

  const groupedRows = useMemo(
    () => computeGroupedBreakdown(cards, groupBy, { binderDefs, allocations }),
    [cards, groupBy, binderDefs, allocations]
  );
  const sortedRows = useMemo(
    () =>
      [...groupedRows].sort((a, b) =>
        measure === 'count' ? b.count - a.count : b.value - a.value
      ),
    [groupedRows, measure]
  );
  const isCappable = groupBy === 'set';
  const visibleRows = isCappable && !showAllSets ? sortedRows.slice(0, SET_ROW_CAP) : sortedRows;
  const measureTotal = useMemo(
    () => sortedRows.reduce((s, r) => s + (measure === 'count' ? r.count : r.value), 0),
    [sortedRows, measure]
  );
  const typeCountTotal = useMemo(
    () => (groupBy === 'type' ? sortedRows.reduce((s, r) => s + r.count, 0) : 0),
    [sortedRows, groupBy]
  );

  return (
    <div className="stats-drawer-root">
      <div
        className={`stats-drawer-backdrop${isClosing ? ' is-closing' : ''}`}
        onClick={() => beginClose()}
        aria-hidden
      />
      <aside
        className={`stats-drawer${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Collection breakdown"
        onAnimationEnd={onAnimationEnd}
      >
        <header className="stats-drawer-header">
          <h2 className="stats-drawer-title">Breakdown</h2>
          <IconButton
            variant="quiet"
            onClick={() => beginClose()}
            label="Close breakdown"
            icon={<X width={20} height={20} strokeWidth={1.8} />}
          />
        </header>

        <div className="stats-drawer-body">
          <ValueTrend />

          {hasInsights && (
            <section className="breakdown-card" aria-label="Collection insights">
              <h3 className="breakdown-title">Insights</h3>
              <div className="collection-insights-list">
                {allocationSplit && (
                  <InsightRow
                    label="Idle cards"
                    detail={`${formatMoney(allocationSplit.idleValue, { wholeDollars: true })} in ${allocationSplit.idleCount.toLocaleString()} cards no deck uses · ${formatMoney(allocationSplit.boundValue, { wholeDollars: true })} in decks`}
                    bar={
                      allocationSplit.idleValue + allocationSplit.boundValue > 0 ? (
                        <StackedBar
                          size="sm"
                          className="collection-insight-row-bar"
                          max={allocationSplit.idleValue + allocationSplit.boundValue}
                          segments={[
                            {
                              key: 'idle',
                              value: allocationSplit.idleValue,
                              color: 'var(--accent)',
                              title: `Idle: ${formatMoney(allocationSplit.idleValue, { wholeDollars: true })}`,
                            },
                            {
                              key: 'in-deck',
                              value: allocationSplit.boundValue,
                              color: 'var(--border-strong)',
                              title: `In decks: ${formatMoney(allocationSplit.boundValue, { wholeDollars: true })}`,
                            },
                          ]}
                        />
                      ) : undefined
                    }
                  />
                )}
                {sparesSummary && (
                  <InsightRow
                    label="Spares"
                    detail={`${sparesSummary.count.toLocaleString()} cop${sparesSummary.count === 1 ? 'y' : 'ies'} worth ${formatMoney(sparesSummary.value, { wholeDollars: true })} beyond what your decks use.`}
                    onClick={() => closeAndJump({ kind: 'surplus' })}
                  />
                )}
                {sharedCopyRows.length > 0 && (
                  // Always the sheet, never a direct deck link: `shortfall >
                  // 0` requires `demand > owned >= 1`, so `demand` (and thus
                  // `wantedBy.length`) is always >= 2 — a returned row is
                  // never wanted by only one deck.
                  <InsightRow
                    label={`${sharedCopyRows.length} card${sharedCopyRows.length === 1 ? '' : 's'} wanted by more decks than you own`}
                    detail={sharedCopyDetail(sharedCopyRows[0])}
                    onClick={() => setSharedCopiesSheetOpen(true)}
                  />
                )}
                {closeToDoneRows.length > 0 &&
                  (closeToDoneRows.length === 1 ? (
                    <InsightRow
                      label="1 deck close to done"
                      detail={closeToDoneDetail(closeToDoneRows[0])}
                      to={`/decks/${closeToDoneRows[0].deckId}`}
                    />
                  ) : (
                    <InsightRow
                      label={`${closeToDoneRows.length} decks close to done`}
                      detail={closeToDoneDetail(closeToDoneRows[0])}
                      onClick={() => setCloseToDoneSheetOpen(true)}
                    />
                  ))}
                {concentration && (
                  <InsightRow
                    label="Concentration"
                    detail={`Your top ${concentration.topCount} cards hold ${concentration.topSharePct}% of your collection's value.`}
                  />
                )}
              </div>
            </section>
          )}

          <CostBasisCard cards={cards} />

          <section className="breakdown-card" aria-label="Collection breakdown by group">
            <div className="breakdown-header-row">
              <h3 className="breakdown-title">Breakdown</h3>
            </div>
            <div className="breakdown-controls">
              <SelectMenu<BreakdownGroupBy>
                value={groupBy}
                onChange={setGroupBy}
                options={BREAKDOWN_GROUP_OPTIONS}
                label="Group by"
                ariaLabel="Group the breakdown by"
              />
              <SegmentedControl<BreakdownMeasure>
                ariaLabel="Measure"
                value={measure}
                onChange={setMeasure}
                options={[
                  { value: 'count', label: 'Count' },
                  { value: 'value', label: 'Value' },
                ]}
              />
            </div>
            {visibleRows.length === 0 ? (
              <EmptyState compact className="breakdown-empty">
                Nothing to break down yet.
              </EmptyState>
            ) : (
              <ul className="breakdown-list">
                {visibleRows.map((row) => (
                  <BreakdownRow
                    key={row.key}
                    row={row}
                    groupBy={groupBy}
                    measure={measure}
                    total={measureTotal}
                    typeCountTotal={typeCountTotal}
                    onSelect={row.filterJump ? () => closeAndJump(row.filterJump!) : undefined}
                  />
                ))}
              </ul>
            )}
            {isCappable && sortedRows.length > visibleRows.length && (
              <Button variant="link" onClick={() => setShowAllSets(true)}>
                Show all {sortedRows.length} sets
              </Button>
            )}
          </section>
        </div>
      </aside>

      {sharedCopiesSheetOpen && (
        <SharedCopiesSheet rows={sharedCopyRows} onClose={() => setSharedCopiesSheetOpen(false)} />
      )}
      {closeToDoneSheetOpen && (
        <CloseToDoneSheet rows={closeToDoneRows} onClose={() => setCloseToDoneSheetOpen(false)} />
      )}
    </div>
  );
}
