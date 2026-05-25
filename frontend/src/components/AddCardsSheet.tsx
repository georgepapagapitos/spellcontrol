import { Camera, Search, Upload, X } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useCanScan } from '../lib/use-can-scan';
import { importText } from '../lib/api';
import { useCollectionStore } from '../store/collection';
import { AddCardSearchPanel } from './AddCardSearchPanel';
import { UploadPanel } from './UploadPanel';
import { CardScanner } from './CardScanner';

type Tab = 'search' | 'upload' | 'scan';

interface Props {
  onClose: () => void;
  /** Optional initial tab. Defaults to 'search'. */
  initialTab?: Tab;
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
export function AddCardsSheet({ onClose, initialTab = 'search' }: Props) {
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
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);

  const importCards = useCollectionStore((s) => s.importCards);
  const labelId = useId();

  useLockBodyScroll();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleScanConfirm = async (text: string, count: number) => {
    setScannerOpen(false);
    setScanError(null);
    setScanBusy(true);
    try {
      const response = await importText(text);
      await importCards(response, 'scanned-cards', 'merge');
      const parts: string[] = [
        `Added ${response.cards.length.toLocaleString()} scanned card${
          response.cards.length === 1 ? '' : 's'
        }`,
      ];
      if (response.unresolvedNames.length > 0) {
        parts.push(`${response.unresolvedNames.length} unresolved`);
      }
      setScanSuccess(parts.join(' · '));
      // Echo the count param so it's used (and the success line stays
      // honest if the parsed-card count ever differs from the scanned
      // count — e.g. duplicate detection on the parser side).
      if (count !== response.cards.length) {
        setScanSuccess(
          `Added ${response.cards.length.toLocaleString()} of ${count.toLocaleString()} scanned cards`
        );
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Could not save scanned cards.');
    } finally {
      setScanBusy(false);
    }
  };

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
      id: 'scan',
      label: 'Scan',
      icon: <Camera width={14} height={14} aria-hidden />,
      available: canScan,
    },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal add-cards-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header add-cards-modal-header">
          <h2 id={labelId}>Add cards</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X width={20} height={20} strokeWidth={1.8} aria-hidden />
          </button>
        </div>

        <div className="add-cards-tabs" role="tablist" aria-label="How to add cards">
          {tabs
            .filter((t) => t.available)
            .map((t) => {
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`add-cards-tab-${t.id}`}
                  aria-selected={active}
                  aria-controls={`add-cards-panel-${t.id}`}
                  tabIndex={active ? 0 : -1}
                  className={`add-cards-tab${active ? ' active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  <span className="add-cards-tab-icon">{t.icon}</span>
                  <span className="add-cards-tab-label">{t.label}</span>
                </button>
              );
            })}
        </div>

        <div className="modal-body add-cards-modal-body">
          <div
            role="tabpanel"
            id="add-cards-panel-search"
            aria-labelledby="add-cards-tab-search"
            hidden={activeTab !== 'search'}
            className="add-cards-panel add-cards-panel-search"
          >
            <AddCardSearchPanel autoFocus={activeTab === 'search'} onEscape={onClose} />
          </div>

          <div
            role="tabpanel"
            id="add-cards-panel-upload"
            aria-labelledby="add-cards-tab-upload"
            hidden={activeTab !== 'upload'}
            className="add-cards-panel add-cards-panel-upload"
          >
            <UploadPanel hideScanButton />
          </div>

          {canScan && (
            <div
              role="tabpanel"
              id="add-cards-panel-scan"
              aria-labelledby="add-cards-tab-scan"
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
                  collection — no mode picker, no re-import. For bulk file imports or paste, use{' '}
                  <button type="button" className="btn-link" onClick={() => setTab('upload')}>
                    Add from list
                  </button>
                  .
                </p>
                <button
                  type="button"
                  className="btn btn-primary scan-tab-launch"
                  onClick={() => {
                    setScanError(null);
                    setScanSuccess(null);
                    setScannerOpen(true);
                  }}
                  disabled={scanBusy}
                >
                  <Camera width={16} height={16} strokeWidth={1.8} aria-hidden />
                  <span>{scanBusy ? 'Importing…' : 'Start scanning'}</span>
                </button>
                {scanSuccess && (
                  <div className="success-banner scan-tab-banner">
                    <span>{scanSuccess}</span>
                    <button
                      type="button"
                      className="banner-dismiss"
                      onClick={() => setScanSuccess(null)}
                      aria-label="Dismiss"
                    >
                      ×
                    </button>
                  </div>
                )}
                {scanError && (
                  <div className="error-banner scan-tab-banner">
                    <span>{scanError}</span>
                    <button
                      type="button"
                      className="banner-dismiss"
                      onClick={() => setScanError(null)}
                      aria-label="Dismiss"
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {scannerOpen && (
        <CardScanner
          onClose={() => setScannerOpen(false)}
          onConfirm={(text, count) => void handleScanConfirm(text, count)}
        />
      )}
    </div>
  );
}
