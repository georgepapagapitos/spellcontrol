import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { MaterializedBinder } from '../types';
import { PageGrid } from './PageGrid';
import { ColorPip } from './shared/ManaSymbol';
import { EmptyState } from './shared/EmptyState';
import { IconButton } from '@/components/shared/Button';
import './BinderEditorPreview.css';

interface Props {
  /** The draft binder's own materialize result (real pocket size, sorts and
   *  page filling — WYSIWYG with Save), or null while the collection is
   *  still hydrating. */
  binder: MaterializedBinder | null;
  loading: boolean;
  fixedCapacity: number | null;
}

/** Binder-wide page list + per-page section labels, and where each section
 *  starts in that flat run — the same derivation BinderView uses to feed its
 *  own page viewer, so a section's reported start page can't drift from the
 *  real binder. */
function useFlatPreview(binder: MaterializedBinder | null) {
  return useMemo(() => {
    const sections = binder?.sections ?? [];
    const pages = sections.flatMap((s) => s.pages);
    const labels = sections.flatMap((s) => s.pages.map((p) => p.labels?.join(' · ') ?? s.label));
    // Each section's start in the flat page run — the sum of every earlier
    // section's page count. Sections number at most a few dozen (colors,
    // types, sets), so the O(n²) re-sum reads clearer than threading an
    // accumulator through the map.
    const sectionRows = sections.map((s, i) => ({
      key: s.key,
      label: s.label,
      pip: s.pip,
      count: s.cards.length,
      pageNum: s.pages[0]?.pageNum ?? null,
      flatIndex: sections.slice(0, i).reduce((n, prev) => n + prev.pages.length, 0),
    }));
    return { pages, labels, sectionRows };
  }, [binder]);
}

export function BinderEditorPreview({ binder, loading, fixedCapacity }: Props) {
  const { pages, labels, sectionRows } = useFlatPreview(binder);
  const [spreadIndex, setSpreadIndex] = useState(0);
  const maxSpread = Math.max(0, Math.ceil(pages.length / 2) - 1);
  const spread = Math.min(spreadIndex, maxSpread);

  if (loading) {
    return (
      <div className="binder-editor-preview">
        <div className="binder-editor-preview-head">
          <span className="binder-editor-preview-title">Preview</span>
        </div>
        <EmptyState compact className="binder-editor-preview-empty" status as="p">
          Loading your cards…
        </EmptyState>
      </div>
    );
  }

  if (!binder) return null;

  if (binder.totalCards === 0) {
    return (
      <div className="binder-editor-preview">
        <div className="binder-editor-preview-head">
          <span className="binder-editor-preview-title">Preview</span>
        </div>
        <EmptyState compact className="binder-editor-preview-empty" as="p">
          Nothing to preview. No cards match here yet.
        </EmptyState>
      </div>
    );
  }

  const binderCount = fixedCapacity ? Math.ceil(binder.totalCards / fixedCapacity) : null;
  const leftPage = pages[spread * 2];
  const rightPage = pages[spread * 2 + 1];

  return (
    <div className="binder-editor-preview">
      <div className="binder-editor-preview-head">
        <span className="binder-editor-preview-title">Preview</span>
        <div className="binder-editor-preview-nav">
          <IconButton
            variant="quiet"
            label="Previous spread"
            disabled={spread === 0}
            onClick={() => setSpreadIndex(spread - 1)}
            icon={<ChevronLeft width={16} height={16} strokeWidth={2} />}
          />
          <IconButton
            variant="quiet"
            label="Next spread"
            disabled={spread >= maxSpread}
            onClick={() => setSpreadIndex(spread + 1)}
            icon={<ChevronRight width={16} height={16} strokeWidth={2} />}
          />
        </div>
      </div>

      {binder.def.mode === 'manual' && (
        <p className="binder-editor-preview-note">
          Manual order: pinned cards, in the order set in Manage cards.
        </p>
      )}

      <div className="binder-editor-preview-spread">
        {[leftPage, rightPage].map((page, i) =>
          page ? (
            <PageGrid
              key={page.pageNum}
              page={page.slots}
              pageNum={page.pageNum}
              pageIndex={spread * 2 + i}
              pocketSize={binder.effectivePocketSize}
              label={labels[spread * 2 + i]}
            />
          ) : (
            <div
              key={`empty-${i}`}
              className="binder-editor-preview-page-empty"
              aria-hidden="true"
            />
          )
        )}
      </div>

      <div className="binder-editor-preview-stats">
        <div className="binder-editor-preview-stat">
          <b>{binder.totalCards.toLocaleString()}</b>
          <span>cards</span>
        </div>
        <div className="binder-editor-preview-stat">
          <b>{binder.totalPages.toLocaleString()}</b>
          <span>pages</span>
        </div>
        {binderCount !== null && fixedCapacity !== null && (
          <div className="binder-editor-preview-stat">
            <b>{binderCount.toLocaleString()}</b>
            <span>
              {binderCount === 1 ? 'binder' : 'binders'} of {fixedCapacity.toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {sectionRows.length > 0 && (
        <>
          <div className="binder-editor-preview-sections-head">
            <span>Sections</span>
            <span>starts on</span>
          </div>
          <ul className="binder-editor-preview-sections">
            {sectionRows.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  className="binder-editor-preview-section-row"
                  onClick={() => setSpreadIndex(Math.floor(s.flatIndex / 2))}
                >
                  <span className="binder-editor-preview-section-label">
                    {s.pip && <ColorPip color={s.key} />}
                    {s.label} · {s.count.toLocaleString()}
                  </span>
                  <span className="binder-editor-preview-section-page">
                    {s.pageNum ? `p. ${s.pageNum}` : '—'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="binder-editor-preview-hint">Select a section to jump the preview to it.</p>
        </>
      )}
    </div>
  );
}
