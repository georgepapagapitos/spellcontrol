import { Suspense, lazy, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const BinderCardEditor = lazy(() =>
  import('../components/BinderCardEditor').then((m) => ({ default: m.BinderCardEditor }))
);
import { useCollectionStore } from '../store/collection';
import { materializeBinders } from '../lib/materialize';
import { useDebouncedValue } from '../lib/use-debounced-value';
import { BinderTabs } from '../components/BinderTabs';
import { BinderPickerSheet } from '../components/BinderPickerSheet';
import { BinderView } from '../components/BinderView';
import { BinderListView } from '../components/BinderListView';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { SearchPill } from '../components/SearchPill';
import { FilterPopover } from '../components/FilterPopover';
import { importText } from '../lib/api';
import { sampleCardsAsCsv, SAMPLE_BINDERS, SAMPLE_CARDS } from '../lib/samples';
import { useConfirm } from '../lib/use-confirm';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';

export function BinderPage() {
  const cards = useCollectionStore((s) => s.cards);
  const binders = useCollectionStore((s) => s.binders);
  const hydrating = useCollectionStore((s) => s.hydrating);
  const error = useCollectionStore((s) => s.error);
  const search = useCollectionStore((s) => s.search);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const setError = useCollectionStore((s) => s.setError);
  const setSearch = useCollectionStore((s) => s.setSearch);
  const setBinderPickerOpen = useCollectionStore((s) => s.setBinderPickerOpen);
  const activeTab = useCollectionStore((s) => s.activeTab);
  const loadSampleBinders = useCollectionStore((s) => s.loadSampleBinders);
  const deleteBinder = useCollectionStore((s) => s.deleteBinder);
  const deleteAllBinders = useCollectionStore((s) => s.deleteAllBinders);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const [showSamplesIntro, setShowSamplesIntro] = useState(false);
  const [loadingSamples, setLoadingSamples] = useState(false);
  const [cardEditorOpen, setCardEditorOpen] = useState(false);
  // Three-way view: 'pages' (the section/page grid) → 'list' (rows
  // with thumbnails + meta) → 'compact' (text-only rows). Local state.
  const [view, setView] = useState<'pages' | 'list' | 'compact'>('pages');
  // List-view only: roll multiple copies of the same printing into one
  // row. Lifted to the page so the options menu in the toolbar can
  // toggle it without poking into the list component.
  const [groupPrintings, setGroupPrintings] = useState(false);

  const hasSampleBinders = useMemo(() => binders.some((b) => b.isSample), [binders]);
  // When the user already has a real collection, "Try it out" should only add
  // the curated binder rules so they filter against the user's own cards —
  // skipping the starter pack avoids polluting the collection.
  const samplesBindersOnly = cards.length > 0;

  const handleConfirmLoadSamples = async () => {
    setLoadingSamples(true);
    setError(null);
    try {
      const response = samplesBindersOnly ? null : await importText(sampleCardsAsCsv());
      await loadSampleBinders(response);
      setShowSamplesIntro(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load samples');
    } finally {
      setLoadingSamples(false);
    }
  };

  // Debounce the value materialize() sees so each keystroke doesn't trigger a
  // full filter/sort/group pass over the whole collection. The input itself
  // still reflects live keystrokes via the un-debounced `search`.
  const debouncedSearch = useDebouncedValue(search, 180);

  // When "group printings" is on we collapse multiple copies of the same
  // (scryfallId, foil) into a single representative copy and remember the
  // total via qtyByCopyId. The materializer then lays out unique
  // printings; CardSlot paints a ×N badge on slots with qty > 1.
  const { effectiveCards, qtyByCopyId } = useMemo(() => {
    if (!groupPrintings) return { effectiveCards: cards, qtyByCopyId: undefined };
    const seen = new Map<string, { card: (typeof cards)[number]; qty: number }>();
    for (const c of cards) {
      const key = `${c.scryfallId}:${c.finish ?? (c.foil ? 'foil' : 'nonfoil')}`;
      const existing = seen.get(key);
      if (existing) existing.qty += 1;
      else seen.set(key, { card: c, qty: 1 });
    }
    const qtyMap = new Map<string, number>();
    const deduped = [...seen.values()].map(({ card, qty }) => {
      qtyMap.set(card.copyId, qty);
      return card;
    });
    return { effectiveCards: deduped, qtyByCopyId: qtyMap };
  }, [cards, groupPrintings]);

  const materialized = useMemo(() => {
    if (effectiveCards.length === 0) return [];
    return materializeBinders(effectiveCards, binders, { search: debouncedSearch }).binders;
  }, [effectiveCards, binders, debouncedSearch]);

  if (hydrating) {
    return (
      <div className="page-loader" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <span className="visually-hidden">Loading</span>
      </div>
    );
  }

  // State: no cards, no binders — fresh slate. Offer import or full samples.
  if (cards.length === 0 && binders.length === 0) {
    return (
      <>
        {error && (
          <div className="error-banner" style={{ marginBottom: '1rem' }}>
            {error}
            <button className="btn-link" style={{ marginLeft: 8 }} onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}
        <div className="empty-state">
          <p className="empty-state-hint">
            No cards yet. Drop in a CSV from ManaBox, Moxfield, or Archidekt to get started.
          </p>
          <div className="empty-state-actions">
            <Link to="/collection" className="btn btn-primary">
              Import your collection
            </Link>
            <button
              type="button"
              className="btn"
              onClick={() => setShowSamplesIntro(true)}
              disabled={loadingSamples}
            >
              Try it out
            </button>
          </div>
        </div>
        {showSamplesIntro && (
          <SamplesIntroDialog
            loading={loadingSamples}
            bindersOnly={false}
            onConfirm={handleConfirmLoadSamples}
            onCancel={() => setShowSamplesIntro(false)}
          />
        )}
      </>
    );
  }

  // State: binders exist but no collection — keep the binder tabs visible so
  // the user's work doesn't appear to vanish, and steer them to import.
  if (cards.length === 0) {
    return (
      <>
        {error && (
          <div className="error-banner" style={{ marginBottom: '1rem' }}>
            {error}
            <button className="btn-link" style={{ marginLeft: 8 }} onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}
        <div className="empty-state">
          <p className="empty-state-tagline">Your binders are waiting on a collection.</p>
          <p className="empty-state-hint">
            {binders.length === 1 ? 'You have 1 binder' : `You have ${binders.length} binders`} set
            up, but no cards to fill {binders.length === 1 ? 'it' : 'them'}. Import a CSV to see
            your rules in action.
          </p>
          <ul className="empty-state-binder-list">
            {[...binders]
              .sort((a, b) => a.position - b.position)
              .map((b) => (
                <li key={b.id}>
                  <span
                    className="empty-state-binder-swatch"
                    style={{ background: b.color ?? 'var(--accent)' }}
                    aria-hidden="true"
                  />
                  <span className="empty-state-binder-name">{b.name}</span>
                  <button
                    type="button"
                    className="empty-state-binder-remove"
                    aria-label={`Delete binder ${b.name}`}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Delete "${b.name}"?`,
                        body: 'This binder and its rules will be removed.',
                        confirmLabel: 'Delete binder',
                        danger: true,
                      });
                      if (ok) deleteBinder(b.id);
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
          </ul>
          <div className="empty-state-actions">
            <Link to="/collection" className="btn btn-primary">
              Import your collection
            </Link>
          </div>
          {binders.length > 1 && (
            <button
              type="button"
              className="btn-link empty-state-link-warn"
              onClick={async () => {
                const ok = await confirm({
                  title: `Delete all ${binders.length} binders?`,
                  body: 'Every binder definition will be removed. Cards will fall back to Uncategorized once a collection is imported.',
                  confirmLabel: 'Delete all binders',
                  danger: true,
                });
                if (ok) deleteAllBinders();
              }}
            >
              Delete all binders
            </button>
          )}
        </div>
        {confirmDialog}
      </>
    );
  }

  // State: collection loaded but no binders — first-binder nudge.
  if (binders.length === 0) {
    return (
      <>
        <div className="empty-state">
          <p className="empty-state-tagline">Build your first binder.</p>
          <p className="empty-state-hint">
            A binder is a set of rules that catches cards from your collection. Make one for each
            deck, format, or theme you want to plan around.
          </p>
          <div className="empty-state-actions">
            <button className="btn btn-primary" onClick={() => setEditingBinder('new')}>
              Create your first binder
            </button>
            {!hasSampleBinders && (
              <button
                type="button"
                className="btn"
                onClick={() => setShowSamplesIntro(true)}
                disabled={loadingSamples}
              >
                Load sample binders
              </button>
            )}
          </div>
          {!hasSampleBinders && (
            <p className="empty-state-hint" style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
              Sample binders are three curated rule sets that filter against your existing
              collection — no extra cards added.
            </p>
          )}
        </div>
        {showSamplesIntro && (
          <SamplesIntroDialog
            loading={loadingSamples}
            bindersOnly={samplesBindersOnly}
            onConfirm={handleConfirmLoadSamples}
            onCancel={() => setShowSamplesIntro(false)}
          />
        )}
      </>
    );
  }

  const active = materialized.find((b) => b.def.id === activeTab) ?? materialized[0];

  // Rendered next to "Collapse all" inside each view's summary line so the
  // mode toggle sits adjacent to the content it switches between.
  const viewToggle = (
    <ViewModeToggle<'pages' | 'list' | 'compact'>
      ariaLabel="Binder view mode"
      value={view}
      onChange={setView}
      options={[
        { value: 'pages', label: 'Pages view', icon: <PagesViewIcon /> },
        { value: 'list', label: 'List view (with thumbnails)', icon: <ListViewIcon /> },
        { value: 'compact', label: 'Compact list (text only)', icon: <CompactListIcon /> },
      ]}
    />
  );

  return (
    <>
      <BinderTabs binders={materialized} />
      <BinderPickerSheet binders={materialized} />
      {active && (
        <header
          className="binder-hero binder-hero--with-actions"
          style={{ ['--binder-color' as string]: active.def.color }}
        >
          <div className="binder-hero-text">
            <h1 className="binder-hero-name">{active.def.name}</h1>
            <p className="binder-hero-meta">
              {active.def.fixedCapacity != null ? (
                <>
                  {active.totalCards.toLocaleString()} / {active.def.fixedCapacity.toLocaleString()}{' '}
                  cards · {active.totalPages.toLocaleString()} /{' '}
                  {Math.ceil(
                    active.def.fixedCapacity / active.effectivePocketSize
                  ).toLocaleString()}{' '}
                  pages
                  {active.totalCards > active.def.fixedCapacity && (
                    <span
                      className="binder-summary-overcap"
                      title={`Over capacity by ${(active.totalCards - active.def.fixedCapacity).toLocaleString()} cards`}
                    >
                      {' '}
                      ⚠ over capacity
                    </span>
                  )}
                </>
              ) : (
                <>
                  {active.totalCards.toLocaleString()} {active.totalCards === 1 ? 'card' : 'cards'}{' '}
                  · {active.totalPages.toLocaleString()}{' '}
                  {active.totalPages === 1 ? 'page' : 'pages'}
                </>
              )}
            </p>
          </div>
          <div className="binder-hero-actions">
            <button
              type="button"
              className="pill-btn"
              aria-haspopup="dialog"
              onClick={() => setCardEditorOpen(true)}
              disabled={!activeTab}
            >
              <EditCardsIcon />
              <span>Edit cards</span>
            </button>
            <button
              type="button"
              className="pill-btn"
              aria-haspopup="dialog"
              onClick={() => setEditingBinder(activeTab)}
              disabled={!activeTab}
            >
              <PencilIcon />
              <span>Edit binder</span>
            </button>
            <button
              type="button"
              className="pill-btn"
              aria-haspopup="dialog"
              onClick={() => setBinderPickerOpen(true)}
            >
              <SwitchBinderIcon />
              <span>Switch binder</span>
            </button>
          </div>
        </header>
      )}
      {active?.def.manualOrder?.length ? (
        <div className="binder-manual-order-bar">
          <span className="sort-mode-badge">Manual order active</span>
          <span className="binder-manual-order-hint">
            Cards are in your custom order. Open "Edit cards" → Order tab to change.
          </span>
        </div>
      ) : null}
      <div className="binder-toolbar">
        <SearchPill
          value={search}
          onChange={setSearch}
          placeholder="Search cards by name..."
          ariaLabel="Search cards by name"
          trailing={
            <FilterPopover
              ariaLabel="Binder options"
              toggles={[
                {
                  key: 'group-printings',
                  label: 'Group printings',
                  hint:
                    view === 'pages'
                      ? 'Collapse duplicate copies into one slot with a ×N badge'
                      : 'Roll multiple copies of the same printing into one row',
                  value: groupPrintings,
                  onChange: setGroupPrintings,
                },
              ]}
            />
          }
        />
      </div>
      {view === 'pages' ? (
        <BinderView binders={materialized} viewToggle={viewToggle} qtyByCopyId={qtyByCopyId} />
      ) : (
        (() => {
          const active = materialized.find((b) => b.def.id === activeTab) ?? materialized[0];
          if (!active) return null;
          // BinderListView preserves the binder's section grouping (the same
          // White / Blue / Multicolor / etc. headers as the page grid view)
          // and rolls duplicate copies into qty pills.
          return (
            <BinderListView
              binder={active}
              viewToggle={viewToggle}
              qtyByCopyId={qtyByCopyId}
              density={view === 'compact' ? 'compact' : 'detail'}
            />
          );
        })()
      )}
      <Suspense fallback={null}>
        {cardEditorOpen && active && (
          <BinderCardEditor
            binder={active}
            allCards={cards}
            onClose={() => setCardEditorOpen(false)}
          />
        )}
      </Suspense>
    </>
  );
}

function EditCardsIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 4h12M2 8h8M2 12h6" />
      <path d="M12 10l1.5 1.5L16 9" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11.3 2.7l2 2L5 13H3v-2l8.3-8.3z" />
    </svg>
  );
}

function PagesViewIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function ListViewIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <circle cx="4" cy="6" r="0.5" />
      <circle cx="4" cy="12" r="0.5" />
      <circle cx="4" cy="18" r="0.5" />
    </svg>
  );
}

function CompactListIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M3 10h18" />
      <path d="M3 14h18" />
      <path d="M3 18h18" />
    </svg>
  );
}

function SwitchBinderIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 5h8M9 3l2 2-2 2" />
      <path d="M13 11H5M7 9l-2 2 2 2" />
    </svg>
  );
}

interface SamplesIntroDialogProps {
  loading: boolean;
  /** When true, only the binder defs are added — the starter pack is skipped. */
  bindersOnly: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function SamplesIntroDialog({
  loading,
  bindersOnly,
  onConfirm,
  onCancel,
}: SamplesIntroDialogProps) {
  useLockBodyScroll();
  return (
    <div className="modal-backdrop" onClick={loading ? undefined : onCancel} role="presentation">
      <div
        className="choice-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="samples-intro-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="samples-intro-title" className="choice-dialog-title">
          {bindersOnly ? 'Load sample binders?' : 'Load samples?'}
        </h2>
        <p className="choice-dialog-body">
          {bindersOnly ? (
            <>
              This will create {SAMPLE_BINDERS.length} sample binders that show off the rule system.
              They will filter against your existing collection — no extra cards are added.
            </>
          ) : (
            <>
              This will create {SAMPLE_BINDERS.length} sample binders that show off the rule system,
              plus a starter pack of {SAMPLE_CARDS.length} cards so each binder has visible matches.
            </>
          )}
        </p>
        <ul className="samples-intro-list">
          {SAMPLE_BINDERS.map((s) => (
            <li key={s.templateId}>
              <strong>{s.input.name}</strong>
            </li>
          ))}
        </ul>
        <p className="choice-dialog-body">
          <strong>Removing samples later:</strong>
        </p>
        <ul className="samples-intro-list">
          <li>
            Each sample binder has an <span className="kbd-inline kbd-inline-danger">✕</span> on its
            tab — that removes just that binder.
          </li>
          {!bindersOnly && (
            <li>
              The bundled cards land in{' '}
              <Link to="/collection" className="link-warn">
                Collection → Import history
              </Link>{' '}
              as "Sample: starter pack". Tick its checkbox and Delete selected to remove them.
            </li>
          )}
        </ul>
        <div className="choice-dialog-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={loading}
            autoFocus
          >
            {loading ? 'Loading…' : bindersOnly ? 'Load sample binders' : 'Load samples'}
          </button>
        </div>
      </div>
    </div>
  );
}
