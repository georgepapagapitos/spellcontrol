import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { BinderSection, EnrichedCard, MaterializedBinder } from '../types';
import { PageGrid } from './PageGrid';
import { BinderPagePreview } from './BinderPagePreview';
import { EmptyState } from './shared/EmptyState';
import { volumesFor, volumesOfCapacity } from '../lib/binder-volumes';
import './BinderEditorPreviewStrip.css';

interface Props {
  binder: MaterializedBinder | null;
  loading: boolean;
  binderName: string;
}

// Duplicated from BinderView.tsx (private there, and that file is owned by a
// parallel binder-rework lane — see E493's scope note). Maps each card in a
// section to the page number it lives on, so the strip's page viewer can
// carry the same "p. N" as every other binder surface.
function pageNumbersForSection(section: BinderSection): number[] {
  const cardToPage = new Map<EnrichedCard, number>();
  section.pages.forEach((page) => {
    page.slots.forEach((slot) => {
      if (slot && !cardToPage.has(slot)) cardToPage.set(slot, page.pageNum);
    });
  });
  return section.cards.map((c) => cardToPage.get(c) ?? 0);
}

/**
 * Phone counterpart to `BinderEditorPreview`: a compact strip under the
 * header instead of a sticky column (no room for one at 390px). Tapping it
 * opens the real page viewer on the draft's own pages.
 */
export function BinderEditorPreviewStrip({ binder, loading, binderName }: Props) {
  const [pagesOpen, setPagesOpen] = useState(false);

  const flat = useMemo(() => {
    const sections = binder?.sections ?? [];
    const pages = sections.flatMap((s) => s.pages);
    const pageLabels = sections.flatMap((s) =>
      s.pages.map((p) => p.labels?.join(' · ') ?? s.label)
    );
    const cards: EnrichedCard[] = [];
    const sectionLabels: string[] = [];
    const pageNumbers: number[] = [];
    const cardIndex = new Map<EnrichedCard, number>();
    for (const section of sections) {
      const sectionPageNumbers = pageNumbersForSection(section);
      section.cards.forEach((card, i) => {
        cardIndex.set(card, cards.length);
        cards.push(card);
        sectionLabels.push(section.cardLabels?.[i] ?? section.label);
        pageNumbers.push(sectionPageNumbers[i] ?? 0);
      });
    }
    return { pages, pageLabels, cards, sectionLabels, pageNumbers, cardIndex };
  }, [binder]);

  if (loading) {
    return (
      <div className="binder-editor-preview-strip is-placeholder">
        <EmptyState compact className="binder-editor-preview-strip-empty" status as="p">
          Loading your cards…
        </EmptyState>
      </div>
    );
  }

  if (!binder || binder.totalCards === 0) {
    return (
      <div className="binder-editor-preview-strip is-placeholder">
        <EmptyState compact className="binder-editor-preview-strip-empty" as="p">
          No cards match here yet.
        </EmptyState>
      </div>
    );
  }

  const firstPage = flat.pages[0];
  const firstLabel = flat.pageLabels[0] ?? '';
  const firstSection = binder.sections[0];
  const startLine = firstSection
    ? `Starts with ${firstSection.label}, ${firstSection.cards.length.toLocaleString()} cards`
    : '';
  // Page-based, from the same pass as the Pages answer (see BinderEditorPreview).
  const fixedCapacity = binder.def.fixedCapacity;
  const binderCount = fixedCapacity !== null ? (volumesFor(binder)?.length ?? null) : null;

  return (
    <>
      <button
        type="button"
        className="binder-editor-preview-strip"
        onClick={() => setPagesOpen(true)}
        aria-label={`Preview pages: ${binder.totalPages.toLocaleString()} pages${
          startLine ? `, ${startLine}` : ''
        }`}
      >
        {firstPage && (
          <div className="binder-editor-preview-strip-thumb" aria-hidden="true">
            <PageGrid
              page={firstPage.slots}
              pageNum={firstPage.pageNum}
              pageIndex={0}
              pocketSize={binder.effectivePocketSize}
              label={firstLabel}
            />
          </div>
        )}
        <span className="binder-editor-preview-strip-text">
          <span className="binder-editor-preview-strip-headline">
            {binder.totalPages.toLocaleString()} {binder.totalPages === 1 ? 'page' : 'pages'}
            {binderCount !== null && fixedCapacity !== null
              ? ` · ${volumesOfCapacity(binderCount, fixedCapacity)}`
              : ''}
          </span>
          {startLine && <span className="binder-editor-preview-strip-sub">{startLine}</span>}
          <span className="binder-editor-preview-strip-hint">Tap to flip through</span>
        </span>
        <ChevronRight
          className="binder-editor-preview-strip-chevron"
          width={18}
          height={18}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>

      {pagesOpen && (
        <BinderPagePreview
          pages={flat.pages}
          pageLabels={flat.pageLabels}
          startPageIndex={0}
          pocketSize={binder.effectivePocketSize}
          binderName={binderName || 'This binder'}
          resolveCard={(card) => {
            const i = flat.cardIndex.get(card);
            if (i === undefined) return null;
            return {
              cards: flat.cards,
              index: i,
              sectionLabels: flat.sectionLabels,
              pageNumbers: flat.pageNumbers,
              totalPages: binder.totalPages,
            };
          }}
          onClose={() => setPagesOpen(false)}
        />
      )}
    </>
  );
}
