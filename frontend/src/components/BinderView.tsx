import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCollectionStore } from '../store/collection';
import type {
  BinderSection,
  EnrichedCard,
  MaterializedBinder,
  PocketSize,
  SortField,
} from '../types';
import { SORT_FIELDS } from '../lib/sorting';
import { PageGrid } from './PageGrid';
import { CardPreview } from './CardPreview';
import { CardPreviewContext } from './CardPreviewContext';
import { BinderPagePreview } from './BinderPagePreview';

const SORT_LABEL: Record<SortField, string> = SORT_FIELDS.reduce(
  (acc, f) => ({ ...acc, [f.value]: f.label }),
  {} as Record<SortField, string>
);

interface Props {
  binders: MaterializedBinder[];
}

export function BinderView({ binders }: Props) {
  const activeTab = useCollectionStore((s) => s.activeTab);
  const setActiveTab = useCollectionStore((s) => s.setActiveTab);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);

  // The Uncategorized bucket is no longer a tab in this view — it lives in the
  // Collection page filter. Migrate any legacy persisted activeTab to the first
  // real binder so users do not land on a dead tab.
  useEffect(() => {
    const matchesABinder = binders.some((b) => b.def.id === activeTab);
    if (matchesABinder || binders.length === 0) return;
    setActiveTab(binders[0].def.id);
  }, [activeTab, binders, setActiveTab]);

  const active = binders.find((b) => b.def.id === activeTab);
  if (!active) {
    return (
      <div className="empty-state">
        Select a binder above, or click <strong>+ New binder</strong> to create one.
      </div>
    );
  }

  if (active.totalCards === 0) {
    return (
      <div className="empty-state">
        No cards match this binder's rules.{' '}
        <button
          className="btn"
          style={{ marginLeft: 8 }}
          onClick={() => setEditingBinder(active.def.id)}
        >
          Edit rules
        </button>
      </div>
    );
  }

  return (
    <SectionList
      viewKey={active.def.id}
      binderName={active.def.name}
      totalCards={active.totalCards}
      totalPages={active.totalPages}
      sections={active.sections}
      pocketSize={active.effectivePocketSize}
      sorts={active.effectiveSorts}
    />
  );
}

function SectionList({
  viewKey,
  binderName,
  totalCards,
  totalPages,
  sections,
  pocketSize,
  sorts,
}: {
  viewKey: string;
  binderName: string;
  totalCards: number;
  totalPages: number;
  sections: BinderSection[];
  pocketSize: PocketSize;
  sorts: SortField[];
}) {
  const activeSorts = sorts.filter((s) => s && s !== 'none');
  const subSortLabels = activeSorts.slice(1).map((s) => SORT_LABEL[s] ?? s);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Reset collapsed state when switching binders/uncategorized so a collapse in
  // one view doesn't carry over into another (different sections, different intent).
  useEffect(() => {
    setCollapsed(new Set());
  }, [viewKey]);

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

  // Reset previews when switching binders so they don't survive a tab change.
  useEffect(() => {
    setPreview(null);
    setPagesStartIndex(null);
  }, [viewKey]);

  // Binder-wide page list + per-page section labels (parallel arrays).
  const flatPages = useMemo(() => sections.flatMap((s) => s.pages), [sections]);
  const flatPageLabels = useMemo(
    () => sections.flatMap((s) => s.pages.map(() => s.label)),
    [sections]
  );

  // Cumulative page-offset per section, for translating section-local page
  // indices (from p{N} clicks) into the global flat-pages index.
  const sectionPageOffsets = useMemo(() => {
    let offset = 0;
    return sections.map((s) => {
      const o = offset;
      offset += s.pages.length;
      return o;
    });
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
        <span className="binder-summary-name">{binderName}</span>
        <span className="binder-summary-meta">
          {totalCards.toLocaleString()} cards · {totalPages.toLocaleString()} page
          {totalPages !== 1 ? 's' : ''}
          {flatPages.length > 0 && (
            <>
              {' · '}
              <button
                type="button"
                className="binder-summary-open"
                onClick={() => setPagesStartIndex(0)}
                aria-label={`Browse pages of ${binderName}`}
              >
                Browse pages
              </button>
            </>
          )}
        </span>
      </div>
      {sections.length > 1 && (
        <div className="section-controls">
          <button
            type="button"
            className="btn-link"
            onClick={allCollapsed ? expandAll : collapseAll}
          >
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
        </div>
      )}
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
            subSortLabels={subSortLabels}
            pocketSize={pocketSize}
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
  subSortLabels,
  pocketSize,
  onToggle,
  onOpenCard,
  onOpenPages,
}: {
  section: BinderSection;
  isCollapsed: boolean;
  headerId: string;
  panelId: string;
  subSortLabels: string[];
  pocketSize: PocketSize;
  onToggle: () => void;
  onOpenCard: (card: EnrichedCard) => void;
  onOpenPages: (startPageIndex: number) => void;
}) {
  // Stable per-section context — CardSlot calls openCard on tap (touch only),
  // PageGrid calls openPages when the page number label is tapped.
  const ctxValue = useMemo(
    () => ({ openCard: onOpenCard, openPages: onOpenPages }),
    [onOpenCard, onOpenPages]
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
          <i className={`ms ${colorKeyToMs(section.key)} ms-cost section-color-icon`} aria-hidden />
        )}
        <span className="section-title">{section.label}</span>
        {subSortLabels.length > 0 && (
          <span className="section-breadcrumb" aria-label="Sort order within this section">
            {subSortLabels.join(' › ')}
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
