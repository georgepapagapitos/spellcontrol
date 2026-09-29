import { Download } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';
import { inkOn } from '@/lib/util/ink';
import type { MaterializedBinder } from '../types';
import { BinderExportDialog } from './BinderExportDialog';
import { Chip } from './shared/Chip';

/**
 * Deliberately diverges from the shared `Tabs` component (board E164): plain
 * `<button className="tab">` elements instead of the primitive's flat
 * `TabItem[]` shape, because each tab fills with its own binder's colour and
 * carries a Manual badge, which `Tabs` has no slot for. (It also used to hang
 * a per-tab ⋯ menu here; E472 removed it: the binder's actions have one home
 * on this page, the header ⋮, shared with its index tile.) E206 closed the resulting a11y gap directly on this component
 * (no second consumer of the affordance set exists, so the STYLE_GUIDE
 * revisit condition for extending `Tabs` wasn't met): the per-binder buttons
 * carry `role="tab"`/`aria-selected` inside a `role="tablist"` wrapper, with
 * roving tabindex and ←/→/Home/End navigation. The wrapper only spans the
 * real tabs — "+ New binder" / "Export" are toolbar actions,
 * not views, so they stay outside it as plain buttons (`display: contents`
 * keeps the wrapper invisible to the `.binder-tab-row` flex layout). Never
 * nest an interactive control inside `role="tab"`: the roving tabindex could
 * not reach it.
 *
 * Ruling (what to keep in lockstep, when to revisit): STYLE_GUIDE.md §
 * "Tabs / view switchers" — "`BinderTabs.tsx` is a deliberate, permanent
 * exception".
 */
interface Props {
  binders: MaterializedBinder[];
}

export function BinderTabs({ binders }: Props) {
  const activeTab = useCollectionStore((s) => s.activeTab);
  const setActiveTab = useCollectionStore((s) => s.setActiveTab);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const navigate = useNavigate();
  const [exportOpen, setExportOpen] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Sort by position so reorder arrows produce a consistent display — hoisted
  // above the handlers below so the roving-tabindex helpers can index into it.
  const sorted = [...binders].sort((a, b) => a.def.position - b.def.position);

  const selectTab = (id: string) => {
    setActiveTab(id);
    navigate(`/collection/binders/${id}`);
  };

  // Roving tabindex + arrow/Home/End navigation (WAI-ARIA tabs, "selection
  // follows focus"). Horizontal-only — the strip never renders vertically —
  // so only Left/Right are wired, matching `aria-orientation="horizontal"`
  // on the tablist below.
  const focusTab = (rawIdx: number) => {
    if (sorted.length === 0) return;
    const idx = ((rawIdx % sorted.length) + sorted.length) % sorted.length;
    const target = sorted[idx];
    if (!target) return;
    selectTab(target.def.id);
    tabRefs.current[idx]?.focus();
  };

  const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        focusTab(idx + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        focusTab(idx - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusTab(0);
        break;
      case 'End':
        e.preventDefault();
        focusTab(sorted.length - 1);
        break;
    }
  };

  return (
    <div className="tab-row binder-tab-row">
      <div
        className="binder-tablist"
        role="tablist"
        aria-label="Binders"
        aria-orientation="horizontal"
      >
        {sorted.map((b, idx) => {
          const isActive = activeTab === b.def.id;
          return (
            <div key={b.def.id} className={`binder-tab-group ${isActive ? 'active' : ''}`}>
              <button
                ref={(el) => {
                  tabRefs.current[idx] = el;
                }}
                role="tab"
                id={`binder-tab-${b.def.id}`}
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                className={`tab ${isActive ? 'active' : ''}`}
                onClick={() => selectTab(b.def.id)}
                onKeyDown={(e) => onTabKeyDown(e, idx)}
                style={
                  isActive
                    ? {
                        background: b.def.color,
                        borderColor: b.def.color,
                        // Mobile underline-tab style picks this up via CSS var.
                        ['--binder-color' as string]: b.def.color,
                        // The label sits on the binder's own fill: ink by its luminance.
                        ['--binder-ink' as string]: inkOn(b.def.color),
                      }
                    : {
                        borderLeftColor: b.def.color,
                        borderLeftWidth: 3,
                        ['--binder-color' as string]: b.def.color,
                      }
                }
              >
                <span className="tab-color-dot" aria-hidden style={{ background: b.def.color }} />
                <span className="tab-label">{b.def.name}</span>
                {b.def.mode === 'manual' && (
                  <Chip className="tab-mode-badge" tone="neutral" aria-label="Manual mode">
                    Manual
                  </Chip>
                )}
                <span className="tab-count">{b.totalCards.toLocaleString()}</span>
              </button>
            </div>
          );
        })}
      </div>

      <button className="tab tab-new" onClick={() => setEditingBinder('new')}>
        + New binder
      </button>

      <button
        type="button"
        className="tab tab-export"
        onClick={() => setExportOpen(true)}
        disabled={binders.length === 0}
      >
        <Download width={14} height={14} strokeWidth={1.8} aria-hidden />
        <span>Export</span>
      </button>

      {exportOpen && (
        <BinderExportDialog
          binders={binders}
          activeId={activeTab}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  );
}
