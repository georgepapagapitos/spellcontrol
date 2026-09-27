import { Camera, Package, Search, Settings, Upload, X } from 'lucide-react';
import { Suspense, lazy, useId, useMemo, useState, type ReactNode } from 'react';
import { useCanScan } from '../lib/use-can-scan';
import { useMediaQuery } from '../lib/use-media-query';
import { importEntries, importScannedCards } from '../lib/scan-import';
import { fetchErrorMessage } from '../lib/import-review';
import { summarizeImportRouting } from '../lib/import-routing';
import { useBinderLayoutInputs } from '../lib/use-binder-layout-inputs';
import { formatMoney } from '../lib/format-money';
import { useCollectionStore } from '../store/collection';
import { rekeyedId, useScanQueue } from '../lib/use-scan-queue';
import { AddCardSearchPanel } from './AddCardSearchPanel';
import { AddCardInspector } from './AddCardInspector';
import { UploadPanel } from './UploadPanel';
import { ProductSearchPanel } from './ProductSearchPanel';
import { ImportRoutingSummary } from './ImportRoutingSummary';
import { Modal } from './Modal';
import { Tabs } from './Tabs';

import { userMessage } from '@/lib/user-error';
import { Button, IconButton } from '@/components/shared/Button';
import type { ScryfallCard } from '@/deck-builder/types';

/** Density tier boundary (STYLE_GUIDE § Layout system): desktop >=1024px gets
 *  the two-pane Search workbench; phone/tablet keep the single-column sheet. */
const DESKTOP_QUERY = '(min-width: 1024px)';
const CardScanner = lazy(() => import('./CardScanner').then((m) => ({ default: m.CardScanner })));
// Lazy so its admin-scanner.css classes stay out of this page's eager chunk
// (css-chunk-ownership.test.ts) — the sheet carries that stylesheet itself.
const ScannerSettingsSheet = lazy(() =>
  import('./ScannerSettingsSheet').then((m) => ({ default: m.ScannerSettingsSheet }))
);
// Same reason: the Add-list review reuses the scanner's own sheets, whose
// classes live in admin-scanner.css too.
const ScannerQueueSheet = lazy(() =>
  import('./ScannerQueueSheet').then((m) => ({ default: m.ScannerQueueSheet }))
);
const ScannerEditSheet = lazy(() =>
  import('./ScannerEditSheet').then((m) => ({ default: m.ScannerEditSheet }))
);

type Tab = 'search' | 'upload' | 'product' | 'scan';

interface Props {
  onClose: () => void;
  /** Optional initial tab. Defaults to 'search'. */
  initialTab?: Tab;
  /** Seeds the Search tab's query — the collection-search hand-off (T153). */
  initialQuery?: string;
}

/**
 * Unified add-cards modal combining single-card Scryfall search,
 * bulk paste/upload, and (when the device supports it) camera scan into a
 * single entry point. Used by the Collection page's "Add cards" hero
 * action; the FAB on native exposes a separate Scan-only shortcut.
 *
 * Tab panels stay mounted across switches so in-flight state (a partial
 * paste, a staged file, an in-progress search) survives navigation. Inactive
 * panels are hidden with CSS rather than unmounted.
 *
 * The Scan tab launches {@link CardScanner} and, on confirm, merges the
 * scanned cards into the collection directly (no mode dialog). Scanning a
 * physical pile is always additive — the import-mode dialog only matters
 * for file/paste flows that might be "import as binder" or "replace
 * collection".
 */
export function AddCardsSheet({ onClose, initialTab = 'search', initialQuery }: Props) {
  const canScan = useCanScan();
  // If the requested initial tab isn't available on this device, fall back
  // to search rather than rendering an empty body.
  const safeInitial: Tab = initialTab === 'scan' && !canScan ? 'search' : initialTab;
  const [tab, setTab] = useState<Tab>(safeInitial);
  // Derived, not stored: if the device loses scan capability mid-session
  // (rare — orientation change crossing the breakpoint) we clamp at render
  // time rather than running an effect that fires setState. Cheap and
  // self-healing; the next user interaction with the tab strip already
  // filters out the Scan tab via the `available` flag.
  const activeTab: Tab = tab === 'scan' && !canScan ? 'search' : tab;
  const [scannerOpen, setScannerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);

  // T153 Add list: the scanner's queue, generalized. Search "+" and the
  // printing picker fill the same persisted list the Scan tab does, reviewed
  // (ScannerQueueSheet, reused) and added at once.
  const {
    queue: addListQueue,
    totalCount: addListCount,
    totalPrice: addListValue,
    addManual: addToAddList,
    removeFromQueue: removeFromAddList,
    clearQueue: clearAddList,
    changeQty: changeAddListQty,
    changePrinting: changeAddListPrinting,
    changeFinish: changeAddListFinish,
    changeCondition: changeAddListCondition,
    changeLanguage: changeAddListLanguage,
  } = useScanQueue();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [addListEditingId, setAddListEditingId] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  // Only the committed import's id + its success sentence are state; the
  // routing summary itself is derived below from `layout`, which decorates
  // and updates as tags/setMap load — never a stale imperative snapshot.
  const [commitSummary, setCommitSummary] = useState<{
    importId: string;
    successLine: string;
  } | null>(null);

  const importCards = useCollectionStore((s) => s.importCards);
  const deleteImports = useCollectionStore((s) => s.deleteImports);
  // Same inputs BinderPage materializes from — shared so the Add-list row
  // prediction and this commit's routing summary can't drift from what a
  // binder actually shows (E457).
  const layout = useBinderLayoutInputs();
  const { binders } = layout;
  const labelId = useId();

  const commitImportIds = useMemo(
    () => (commitSummary ? new Set([commitSummary.importId]) : new Set<string>()),
    [commitSummary]
  );
  const commitRouting = useMemo(
    () => summarizeImportRouting(commitImportIds, layout),
    [commitImportIds, layout]
  );

  // Desktop Search workbench (T153 phase 4): a live inspector pane tracks
  // the active result row instead of each row's own printing disclosure.
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [activeSearchCard, setActiveSearchCard] = useState<ScryfallCard | null>(null);

  /** Resolves true once the cards are in the collection, so the scanner takes
   *  those rows off its list (it used to keep them, ready to add twice). A
   *  failed import keeps them for a retry. Commits through the same
   *  `importEntries` path as the Add-list bar below — one function, one
   *  history entry shape, for either trigger. */
  const handleScanConfirm = async (text: string, count: number): Promise<boolean> => {
    setScannerOpen(false);
    setScanError(null);
    setScanBusy(true);
    try {
      const { added, requested, unresolved, fetchErrors } = await importScannedCards(
        text,
        count,
        importCards
      );
      // Keep the success line honest if the parsed-card count differs from
      // the scanned count (e.g. duplicate detection on the parser side).
      if (added !== requested) {
        const parts = [
          `Added ${added.toLocaleString()} of ${requested.toLocaleString()} scanned cards`,
        ];
        if (fetchErrors > 0) {
          parts.push(fetchErrorMessage(fetchErrors, 'Retry from “Add from list.”'));
        }
        setScanSuccess(parts.join(' · '));
      } else {
        const parts = [`Added ${added.toLocaleString()} scanned card${added === 1 ? '' : 's'}`];
        if (unresolved > 0) parts.push(`${unresolved} unresolved`);
        if (fetchErrors > 0) {
          parts.push(fetchErrorMessage(fetchErrors, 'Retry from “Add from list.”'));
        }
        setScanSuccess(parts.join(' · '));
      }
      return true;
    } catch (err) {
      setScanError(userMessage(err, "Couldn't save scanned cards."));
      return false;
    } finally {
      setScanBusy(false);
    }
  };

  /**
   * Commit the Add list ("Add N" from the bar, or the review sheet's
   * footer): one `importEntries` call for the given rows (or the whole list),
   * then clear exactly what landed and show the routing summary + an Undo
   * that removes exactly this import (`deleteImports` already carries its own
   * toast + Undo, so this just calls it).
   */
  const handleCommitAddList = async (ids?: string[]) => {
    const rows = ids ? addListQueue.filter((e) => ids.includes(e.id)) : addListQueue;
    if (rows.length === 0) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const { added, requested, unresolved, fetchErrors, importId } = await importEntries(
        rows,
        importCards
      );
      removeFromAddList(rows.map((e) => e.id));
      setReviewOpen(false);
      const parts = [
        `Added ${added.toLocaleString()}${added === requested ? '' : ` of ${requested.toLocaleString()}`} card${added === 1 ? '' : 's'}`,
      ];
      if (unresolved > 0) parts.push(`${unresolved} unresolved`);
      if (fetchErrors > 0)
        parts.push(fetchErrorMessage(fetchErrors, 'Retry from the import page.'));
      // The routing summary itself is derived from `layout` above, which
      // picks up the just-imported cards (and any tags/setMap still loading)
      // as soon as it re-renders — no imperative snapshot to go stale.
      setCommitSummary({ importId, successLine: parts.join(' · ') });
    } catch (err) {
      setCommitError(userMessage(err, "Couldn't add those cards."));
    } finally {
      setCommitting(false);
    }
  };

  const addListEditing = addListQueue.find((e) => e.id === addListEditingId) ?? null;

  const tabs: Array<{ id: Tab; label: string; icon: ReactNode; available: boolean }> = [
    {
      id: 'search',
      label: 'Search',
      icon: <Search width={14} height={14} aria-hidden />,
      available: true,
    },
    {
      id: 'upload',
      label: 'Add from list',
      icon: <Upload width={14} height={14} aria-hidden />,
      available: true,
    },
    {
      id: 'product',
      label: 'Products',
      icon: <Package width={14} height={14} aria-hidden />,
      available: true,
    },
    {
      id: 'scan',
      label: 'Scan',
      icon: <Camera width={14} height={14} aria-hidden />,
      available: canScan,
    },
  ];

  return (
    <>
      {/* The shared Modal: focus trap and restore, exit animation, hardware
          back, the overlay-layer Escape stack (topmost-only, so the Add-list
          review / a row edit / the scanner / its settings answer Escape
          first when stacked above this). `add-cards-backdrop` is a bottom
          sheet below 1024px and a centered workspace dialog at and above it
          (STYLE_GUIDE § Overlays). */}
      <Modal
        onClose={onClose}
        className="modal add-cards-modal"
        backdropClassName="add-cards-backdrop"
        labelledBy={labelId}
      >
        <div className="modal-header add-cards-modal-header">
          <h2 id={labelId}>Add cards</h2>
          <div className="add-cards-header-actions">
            {/* Reuses the quiet icon-button look — a header glyph button, not
                literally a close action. */}
            <IconButton
              variant="quiet"
              label="Add settings"
              icon={<Settings width={18} height={18} strokeWidth={1.8} />}
              onClick={() => setSettingsOpen(true)}
            />
            {/* A dialog's own close button unmounts directly — Modal reserves
                its animated exit for Escape/backdrop dismissal. */}
            <IconButton
              variant="quiet"
              onClick={onClose}
              label="Close"
              icon={<X width={20} height={20} strokeWidth={1.8} />}
            />
          </div>
        </div>

        <Tabs
          ariaLabel="How to add cards"
          variant="underline"
          className="add-cards-tabs"
          value={activeTab}
          onChange={setTab}
          tabs={tabs
            .filter((t) => t.available)
            .map((t) => ({
              id: t.id,
              label: t.label,
              icon: t.icon,
              controls: `add-cards-panel-${t.id}`,
            }))}
        />

        <div className="modal-body add-cards-modal-body">
          <div
            role="tabpanel"
            id="add-cards-panel-search"
            aria-labelledby="sc-tab-search"
            hidden={activeTab !== 'search'}
            className="add-cards-panel add-cards-panel-search"
          >
            {/* Desktop (>=1024px): a two-pane workbench — results on the
                left, a live inspector for the active row on the right,
                which replaces the per-row "Printing & finish" disclosure.
                Below that, unchanged: one column, the disclosure stays. */}
            <div className="add-cards-search-workbench">
              <AddCardSearchPanel
                autoFocus={activeTab === 'search'}
                initialQuery={initialQuery}
                onEscape={onClose}
                addToList
                onActiveChange={isDesktop ? setActiveSearchCard : undefined}
                hideRowDisclosure={isDesktop}
              />
              {isDesktop && (
                <AddCardInspector
                  card={activeSearchCard}
                  onAdd={(printing, finish, extras) =>
                    addToAddList(printing, {
                      finish,
                      condition: extras.condition,
                      language: extras.language,
                      qty: extras.quantity,
                      source: 'searched',
                    })
                  }
                />
              )}
            </div>
          </div>

          <div
            role="tabpanel"
            id="add-cards-panel-upload"
            aria-labelledby="sc-tab-upload"
            hidden={activeTab !== 'upload'}
            className="add-cards-panel add-cards-panel-upload"
          >
            <UploadPanel hideScanButton />
          </div>

          <div
            role="tabpanel"
            id="add-cards-panel-product"
            aria-labelledby="sc-tab-product"
            hidden={activeTab !== 'product'}
            className="add-cards-panel add-cards-panel-product"
          >
            <ProductSearchPanel onClose={onClose} />
          </div>

          {canScan && (
            <div
              role="tabpanel"
              id="add-cards-panel-scan"
              aria-labelledby="sc-tab-scan"
              hidden={activeTab !== 'scan'}
              className="add-cards-panel add-cards-panel-scan"
            >
              <div className="scan-tab">
                <div className="scan-tab-icon" aria-hidden>
                  <Camera width={36} height={36} strokeWidth={1.6} />
                </div>
                <h3 className="scan-tab-title">Scan cards with your camera</h3>
                <p className="scan-tab-desc">
                  Point your camera at one card at a time. Each match is added straight to your
                  collection, no mode picker or re-import needed. For bulk file imports or paste,
                  use{' '}
                  <Button variant="link" onClick={() => setTab('upload')}>
                    Add from list
                  </Button>
                  .
                </p>
                <Button
                  variant="primary"
                  onClick={() => {
                    setScanError(null);
                    setScanSuccess(null);
                    setScannerOpen(true);
                  }}
                  disabled={scanBusy}
                  className="scan-tab-launch"
                  icon={<Camera width={16} height={16} strokeWidth={1.8} />}
                >
                  {scanBusy ? 'Importing…' : 'Start scanning'}
                </Button>
                {scanSuccess && (
                  <div className="success-banner scan-tab-banner">
                    <span>{scanSuccess}</span>
                    <IconButton
                      variant="quiet"
                      className="banner-dismiss"
                      onClick={() => setScanSuccess(null)}
                      label="Dismiss"
                      icon={<X width={16} height={16} strokeWidth={2} />}
                    />
                  </div>
                )}
                {scanError && (
                  <div className="error-banner scan-tab-banner">
                    <span>{scanError}</span>
                    <IconButton
                      variant="quiet"
                      className="banner-dismiss"
                      onClick={() => setScanError(null)}
                      label="Dismiss"
                      icon={<X width={16} height={16} strokeWidth={2} />}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {commitSummary && (
          <div className="import-review add-cards-commit-review" role="status" aria-live="polite">
            <div className="import-review-header">
              <span className="import-review-title">Added to your collection</span>
              <IconButton
                variant="quiet"
                className="banner-dismiss"
                onClick={() => setCommitSummary(null)}
                label="Dismiss"
                icon={<X width={16} height={16} strokeWidth={2} />}
              />
            </div>
            <p className="import-review-line">{commitSummary.successLine}</p>
            {(commitRouting.entries.length > 0 || commitRouting.unroutedCount > 0) && (
              <div className="import-review-section import-review-section--routing">
                <ImportRoutingSummary summary={commitRouting} />
              </div>
            )}
            <div className="import-review-section add-cards-commit-undo">
              <Button
                onClick={() => {
                  void deleteImports([commitSummary.importId]);
                  setCommitSummary(null);
                }}
              >
                Undo
              </Button>
            </div>
          </div>
        )}

        {commitError && (
          <div className="error-banner add-cards-commit-error" role="alert">
            <span>{commitError}</span>
            <IconButton
              variant="quiet"
              className="banner-dismiss"
              onClick={() => setCommitError(null)}
              label="Dismiss"
              icon={<X width={16} height={16} strokeWidth={2} />}
            />
          </div>
        )}

        {addListCount > 0 && (
          <div className="modal-footer add-cards-list-bar">
            <span className="add-cards-list-bar-thumbs" aria-hidden="true">
              {[...addListQueue]
                .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
                .slice(0, 3)
                .map((e) => {
                  const img = e.card.image_uris?.small || e.card.card_faces?.[0]?.image_uris?.small;
                  return (
                    <span key={e.id} className="add-cards-list-bar-thumb">
                      {img && <img src={img} alt="" loading="lazy" />}
                    </span>
                  );
                })}
            </span>
            <span className="add-cards-list-bar-summary">
              <b>
                {addListCount} card{addListCount === 1 ? '' : 's'}
              </b>
              <span>{formatMoney(addListValue)}</span>
            </span>
            <Button onClick={() => setReviewOpen(true)}>Review</Button>
            <Button
              variant="primary"
              disabled={committing}
              onClick={() => void handleCommitAddList()}
            >
              {committing ? 'Adding…' : `Add ${addListCount}`}
            </Button>
          </div>
        )}
      </Modal>

      {scannerOpen && (
        <Suspense fallback={null}>
          <CardScanner onClose={() => setScannerOpen(false)} onConfirm={handleScanConfirm} />
        </Suspense>
      )}

      {settingsOpen && (
        <Suspense fallback={null}>
          <ScannerSettingsSheet
            onClose={() => setSettingsOpen(false)}
            showScannerSection={canScan}
          />
        </Suspense>
      )}

      {reviewOpen && (
        <Suspense fallback={null}>
          <ScannerQueueSheet
            entries={addListQueue}
            binders={binders}
            heading={`${addListCount} card${addListCount === 1 ? '' : 's'}`}
            onClose={() => setReviewOpen(false)}
            onEdit={setAddListEditingId}
            onRemove={removeFromAddList}
            onClearAll={clearAddList}
            onChangeFinish={changeAddListFinish}
            onChangeCondition={changeAddListCondition}
            onChangeLanguage={changeAddListLanguage}
            onAddCard={(card) => addToAddList(card, { source: 'searched' })}
            onConfirm={(ids) => void handleCommitAddList(ids)}
          />
        </Suspense>
      )}

      {addListEditing && (
        <Suspense fallback={null}>
          <ScannerEditSheet
            entry={addListEditing}
            onClose={() => setAddListEditingId(null)}
            onFinish={(f) => {
              changeAddListFinish(addListEditing.id, f);
              setAddListEditingId(rekeyedId(addListEditing.card, f));
            }}
            onCondition={(c) => changeAddListCondition(addListEditing.id, c)}
            onLanguage={(l) => changeAddListLanguage(addListEditing.id, l)}
            onQty={(d) => changeAddListQty(addListEditing.id, d)}
            onPrinting={(card) => {
              changeAddListPrinting(addListEditing.id, card);
              setAddListEditingId(rekeyedId(card, addListEditing.finish));
            }}
            onRemove={() => {
              removeFromAddList(addListEditing.id);
              setAddListEditingId(null);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
