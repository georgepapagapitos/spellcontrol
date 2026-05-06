import { useEffect, useMemo, useState } from 'react';
import { useCollectionStore } from '../store/collection';
import type {
  BinderSection,
  EnrichedCard,
  MaterializedBinder,
  PocketSize,
  SortField,
  UncategorizedBucket,
} from '../types';
import { SORT_FIELDS } from '../lib/sorting';
import { PageGrid } from './PageGrid';
import { CardPreview } from './CardPreview';
import { CardPreviewContext } from './CardPreviewContext';

const SORT_LABEL: Record<SortField, string> = SORT_FIELDS.reduce(
  (acc, f) => ({ ...acc, [f.value]: f.label }),
  {} as Record<SortField, string>
);

interface Props {
  binders: MaterializedBinder[];
  uncategorized: UncategorizedBucket;
}

export function BinderView({ binders, uncategorized }: Props) {
  const { activeTab, setEditingBinder } = useCollectionStore();

  if (activeTab === 'uncategorized') {
    if (uncategorized.totalCards === 0) {
      return (
        <div className="empty-state">🎉 Every card has a binder. Nothing left to categorize.</div>
      );
    }
    return (
      <SectionList
        viewKey="uncategorized"
        sections={uncategorized.sections}
        pocketSize={uncategorized.effectivePocketSize}
        sorts={uncategorized.effectiveSorts}
      />
    );
  }

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
      sections={active.sections}
      pocketSize={active.effectivePocketSize}
      sorts={active.effectiveSorts}
    />
  );
}

function SectionList({
  viewKey,
  sections,
  pocketSize,
  sorts,
}: {
  viewKey: string;
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
  const [preview, setPreview] = useState<{ cards: EnrichedCard[]; index: number } | null>(null);

  // Reset preview when switching binders so it doesn't survive a tab change.
  useEffect(() => {
    setPreview(null);
  }, [viewKey]);

  return (
    <>
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
      {sections.map((section) => {
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
              const i = section.cards.indexOf(card);
              if (i >= 0) setPreview({ cards: section.cards, index: i });
            }}
          />
        );
      })}
      {preview && (
        <CardPreview
          cards={preview.cards}
          index={preview.index}
          onIndexChange={(i) => setPreview((p) => (p ? { ...p, index: i } : p))}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
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
}: {
  section: BinderSection;
  isCollapsed: boolean;
  headerId: string;
  panelId: string;
  subSortLabels: string[];
  pocketSize: PocketSize;
  onToggle: () => void;
  onOpenCard: (card: EnrichedCard) => void;
}) {
  // Stable per-section context — CardSlot calls openCard on tap (touch only).
  const ctxValue = useMemo(() => ({ openCard: onOpenCard }), [onOpenCard]);

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
          <div
            className="color-pip"
            style={{ background: section.pip.background, borderColor: section.pip.border }}
          />
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
            {section.pages.map((page) => (
              <PageGrid
                key={page.pageNum}
                page={page.slots}
                pageNum={page.pageNum}
                pocketSize={pocketSize}
              />
            ))}
          </div>
        </CardPreviewContext.Provider>
      )}
    </div>
  );
}
