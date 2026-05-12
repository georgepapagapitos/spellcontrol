import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCollectionStore } from '../store/collection';
import type {
  BinderSection,
  EnrichedCard,
  MaterializedBinder,
  PocketSize,
  SortEntry,
  SortField,
} from '../types';
import { SORT_FIELDS } from '../lib/sorting';
import { PageGrid } from './PageGrid';
import { CardPreview } from './CardPreview';
import { CardPreviewContext } from './CardPreviewContext';
import { BinderPagePreview } from './BinderPagePreview';
import { Legend } from './Legend';
import { useConfirm } from '../lib/use-confirm';

const SORT_LABEL: Record<SortField, string> = SORT_FIELDS.reduce(
  (acc, f) => ({ ...acc, [f.value]: f.label }),
  {} as Record<SortField, string>
);

const SORT_DEFAULT_DIR: Record<SortField, 'asc' | 'desc'> = SORT_FIELDS.reduce(
  (acc, f) => ({ ...acc, [f.value]: f.defaultDir }),
  {} as Record<SortField, 'asc' | 'desc'>
);

function sortEntryLabel(entry: SortEntry): string {
  const label = SORT_LABEL[entry.field] ?? entry.field;
  const isNonDefault = entry.dir !== (SORT_DEFAULT_DIR[entry.field] ?? 'asc');
  if (!isNonDefault) return label;
  return `${label} ${entry.dir === 'asc' ? '↑' : '↓'}`;
}

interface Props {
  binders: MaterializedBinder[];
  /** Optional slot rendered in the summary line next to "Collapse all". */
  viewToggle?: React.ReactNode;
  /** Per-copyId qty when binder is in group-printings mode (otherwise undefined). */
  qtyByCopyId?: Map<string, number>;
}

export function BinderView({ binders, viewToggle, qtyByCopyId }: Props) {
  const activeTab = useCollectionStore((s) => s.activeTab);
  const setActiveTab = useCollectionStore((s) => s.setActiveTab);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const deleteBinder = useCollectionStore((s) => s.deleteBinder);
  const { confirm, dialog: confirmDialog } = useConfirm();

  // The Uncategorized bucket is no longer a tab in this view — it lives in the
  // Collection page filter. Migrate any legacy persisted activeTab to the first
  // real binder so users do not land on a dead tab.
  useEffect(() => {
    const matchesABinder = binders.some((b) => b.def.id === activeTab);
    if (matchesABinder || binders.length === 0) return;
    setActiveTab(binders[0].def.id);
  }, [activeTab, binders, setActiveTab]);

  const active = binders.find((b) => b.def.id === activeTab);

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: `Delete "${name}"?`,
      body: `Its cards will be re-routed through your other binders. Anything that does not match a remaining binder will only show up in the Collection view.`,
      confirmLabel: 'Delete binder',
      danger: true,
    });
    if (ok) deleteBinder(id);
  };

  if (!active) {
    return (
      <div className="empty-state">
        Select a binder above, or click <strong>+ New binder</strong> to create one.
      </div>
    );
  }

  if (active.totalCards === 0) {
    return (
      <>
        <div className="empty-state">
          No cards match this binder's rules.{' '}
          <button
            className="btn"
            style={{ marginLeft: 8 }}
            onClick={() => setEditingBinder(active.def.id)}
          >
            Edit rules
          </button>
          <button
            className="btn btn-danger"
            style={{ marginLeft: 8 }}
            onClick={() => handleDelete(active.def.id, active.def.name)}
          >
            Delete binder
          </button>
        </div>
        {confirmDialog}
      </>
    );
  }

  return (
    <>
      <SectionList
        viewKey={active.def.id}
        binderName={active.def.name}
        totalPages={active.totalPages}
        sections={active.sections}
        pocketSize={active.effectivePocketSize}
        sorts={active.effectiveSorts}
        viewToggle={viewToggle}
        qtyByCopyId={qtyByCopyId}
        onDelete={() => handleDelete(active.def.id, active.def.name)}
      />
      {confirmDialog}
    </>
  );
}

function SectionList({
  viewKey,
  binderName,
  totalPages,
  sections,
  pocketSize,
  sorts,
  viewToggle,
  qtyByCopyId,
  onDelete,
}: {
  viewKey: string;
  binderName: string;
  totalPages: number;
  sections: BinderSection[];
  pocketSize: PocketSize;
  sorts: SortEntry[];
  viewToggle?: React.ReactNode;
  qtyByCopyId?: Map<string, number>;
  onDelete?: () => void;
}) {
  const activeSorts = sorts.filter((s) => s && s.field !== 'none');
  // Full sort breadcrumb (e.g. "Color › CMC ↓ › Name") — communicates the
  // section's grouping and the within-section ordering at the same time.
  const sortBreadcrumb = activeSorts.map(sortEntryLabel);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Tap-to-preview state (touch devices). Tracks which section's card list to
  // walk and the active card index. Closes when index goes out of range.
  const [preview, setPreview] = useState<{
    cards: EnrichedCard[];
    index: number;
    sectionLabels: string[];
    pageNumbers: number[];
    totalPages: number;
  } | null>(null);

  // Binder-wide flipbook: all sections' pages flattened into one swipe
  // sequence. The Open button starts at 0; per-page p{N} links start at the
  // global offset of that page.
  const [pagesStartIndex, setPagesStartIndex] = useState<number | null>(null);

  // Reset collapsed state and previews when switching binders so state from
  // one view doesn't carry over into another (different sections, different intent).
  const [prevViewKey, setPrevViewKey] = useState(viewKey);
  if (prevViewKey !== viewKey) {
    setPrevViewKey(viewKey);
    setCollapsed(new Set());
    setPreview(null);
    setPagesStartIndex(null);
  }

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allCollapsed = sections.length > 0 && sections.every((s) => collapsed.has(s.key));
  const collapseAll = () => setCollapsed(new Set(sections.map((s) => s.key)));
  const expandAll = () => setCollapsed(new Set());

  // Binder-wide page list + per-page section labels (parallel arrays).
  const flatPages = useMemo(() => sections.flatMap((s) => s.pages), [sections]);
  const flatPageLabels = useMemo(
    () => sections.flatMap((s) => s.pages.map(() => s.label)),
    [sections]
  );

  // Cumulative page-offset per section, for translating section-local page
  // indices (from p{N} clicks) into the global flat-pages index.
  const sectionPageOffsets = useMemo(() => {
    return sections.reduce<{ offsets: number[]; total: number }>(
      (acc, s) => {
        acc.offsets.push(acc.total);
        return { offsets: acc.offsets, total: acc.total + s.pages.length };
      },
      { offsets: [], total: 0 }
    ).offsets;
  }, [sections]);

  // Flat binder-wide arrays so CardPreview can navigate past section boundaries.
  // Each parallel array is keyed by the global card index.
  const flatCards = useMemo(() => {
    const cards: EnrichedCard[] = [];
    const sectionLabels: string[] = [];
    const pageNumbers: number[] = [];
    const cardIndex = new Map<EnrichedCard, number>();
    for (const section of sections) {
      const sectionPageNumbers = pageNumbersForSection(section);
      section.cards.forEach((card, i) => {
        cardIndex.set(card, cards.length);
        cards.push(card);
        sectionLabels.push(section.label);
        pageNumbers.push(sectionPageNumbers[i] ?? 0);
      });
    }
    return { cards, sectionLabels, pageNumbers, cardIndex };
  }, [sections]);

  const resolveCard = useCallback(
    (card: EnrichedCard) => {
      const i = flatCards.cardIndex.get(card);
      if (i === undefined) return null;
      return {
        cards: flatCards.cards,
        index: i,
        sectionLabels: flatCards.sectionLabels,
        pageNumbers: flatCards.pageNumbers,
        totalPages,
      };
    },
    [flatCards, totalPages]
  );

  return (
    <>
      <div className="binder-summary" aria-live="polite">
        <span className="binder-summary-meta">
          {flatPages.length > 0 && (
            <>
              <button
                type="button"
                className="binder-summary-open"
                onClick={() => setPagesStartIndex(0)}
                aria-label={`Browse pages of ${binderName}`}
              >
                Browse pages
              </button>
              {' · '}
            </>
          )}
          <Legend />
        </span>
        {sections.length > 1 && (
          <button
            type="button"
            className="btn-link binder-summary-collapse"
            onClick={allCollapsed ? expandAll : collapseAll}
          >
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
        )}
        {onDelete && (
          <button type="button" className="btn-link binder-summary-delete" onClick={onDelete}>
            Delete binder
          </button>
        )}
        {viewToggle && <div className="binder-summary-viewmode">{viewToggle}</div>}
      </div>
      {sections.map((section, sectionIdx) => {
        const isCollapsed = collapsed.has(section.key);
        const headerId = `section-header-${viewKey}-${section.key}`;
        const panelId = `section-panel-${viewKey}-${section.key}`;
        return (
          <SectionBlock
            key={section.key}
            section={section}
            isCollapsed={isCollapsed}
            headerId={headerId}
            panelId={panelId}
            sortBreadcrumb={sortBreadcrumb}
            pocketSize={pocketSize}
            isPreviewOpen={preview !== null || pagesStartIndex !== null}
            qtyByCopyId={qtyByCopyId}
            onToggle={() => toggle(section.key)}
            onOpenCard={(card) => {
              const i = flatCards.cardIndex.get(card);
              if (i === undefined) return;
              setPreview({
                cards: flatCards.cards,
                index: i,
                sectionLabels: flatCards.sectionLabels,
                pageNumbers: flatCards.pageNumbers,
                totalPages,
              });
            }}
            onOpenPages={(localPageIndex) =>
              setPagesStartIndex(sectionPageOffsets[sectionIdx] + localPageIndex)
            }
          />
        );
      })}
      {preview && (
        <CardPreview
          cards={preview.cards}
          index={preview.index}
          binderName={binderName}
          sectionLabels={preview.sectionLabels}
          pageNumbers={preview.pageNumbers}
          totalPages={preview.totalPages}
          onIndexChange={(i) => setPreview((p) => (p ? { ...p, index: i } : p))}
          onClose={() => setPreview(null)}
        />
      )}
      {pagesStartIndex !== null && (
        <BinderPagePreview
          pages={flatPages}
          pageLabels={flatPageLabels}
          startPageIndex={pagesStartIndex}
          pocketSize={pocketSize}
          binderName={binderName}
          resolveCard={resolveCard}
          onClose={() => setPagesStartIndex(null)}
        />
      )}
    </>
  );
}

// Build a parallel array mapping each card in `section.cards` to the page
// number it lives on. Used by both previews to show "p.N" alongside a card.
/** Map a color section key (W/U/B/R/G/M/C/L/?) to its mana-font class. */
function colorKeyToMs(key: string): string {
  switch (key) {
    case 'W':
    case 'U':
    case 'B':
    case 'R':
    case 'G':
      return `ms-${key.toLowerCase()}`;
    case 'M':
      return 'ms-multicolor';
    case 'C':
    case 'L':
      return 'ms-c';
    default:
      return 'ms-c';
  }
}

function pageNumbersForSection(section: BinderSection): number[] {
  const cardToPage = new Map<EnrichedCard, number>();
  section.pages.forEach((page) => {
    page.slots.forEach((slot) => {
      if (slot && !cardToPage.has(slot)) cardToPage.set(slot, page.pageNum);
    });
  });
  return section.cards.map((c) => cardToPage.get(c) ?? 0);
}

function SectionBlock({
  section,
  isCollapsed,
  headerId,
  panelId,
  sortBreadcrumb,
  pocketSize,
  isPreviewOpen,
  qtyByCopyId,
  onToggle,
  onOpenCard,
  onOpenPages,
}: {
  section: BinderSection;
  isCollapsed: boolean;
  headerId: string;
  panelId: string;
  sortBreadcrumb: string[];
  pocketSize: PocketSize;
  isPreviewOpen: boolean;
  qtyByCopyId?: Map<string, number>;
  onToggle: () => void;
  onOpenCard: (card: EnrichedCard) => void;
  onOpenPages: (startPageIndex: number) => void;
}) {
  // Stable per-section context — CardSlot calls openCard on tap (touch only),
  // PageGrid calls openPages when the page number label is tapped.
  const ctxValue = useMemo(
    () => ({ openCard: onOpenCard, openPages: onOpenPages, isPreviewOpen, qtyByCopyId }),
    [onOpenCard, onOpenPages, isPreviewOpen, qtyByCopyId]
  );

  return (
    <div className="binder-section">
      <button
        type="button"
        id={headerId}
        className={`section-header section-header-toggle ${isCollapsed ? 'collapsed' : ''}`}
        onClick={onToggle}
        aria-expanded={!isCollapsed}
        aria-controls={panelId}
      >
        <span className="section-chevron" aria-hidden="true">
          ▾
        </span>
        {section.pip && (
          <i
            className={`ms ${colorKeyToMs(section.key)} ms-cost color-pip-mana color-pip-mana--lg`}
            aria-hidden
          />
        )}
        <span className="section-title">{section.label}</span>
        {sortBreadcrumb.length > 0 && (
          <span className="section-breadcrumb" aria-label="Sort order">
            {sortBreadcrumb.join(' › ')}
          </span>
        )}
        <span className="section-meta">
          {section.cards.length} cards · {section.pages.length} page
          {section.pages.length !== 1 ? 's' : ''}
        </span>
      </button>
      {!isCollapsed && (
        <CardPreviewContext.Provider value={ctxValue}>
          <div id={panelId} role="region" aria-labelledby={headerId} className="page-row">
            {section.pages.map((page, idx) => (
              <PageGrid
                key={page.pageNum}
                page={page.slots}
                pageNum={page.pageNum}
                pageIndex={idx}
                pocketSize={pocketSize}
              />
            ))}
          </div>
        </CardPreviewContext.Provider>
      )}
    </div>
  );
}
