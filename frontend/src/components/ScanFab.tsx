import { Camera } from 'lucide-react';
import { Suspense, lazy, useState } from 'react';
import { useCanScan } from '../lib/use-can-scan';
import { useCollectionStore } from '../store/collection';
import { toast } from '../store/toasts';
import { importScannedCards } from '../lib/scan-import';
import { useScanQueueStore } from '../lib/use-scan-queue';

const CardScanner = lazy(() => import('./CardScanner').then((m) => ({ default: m.CardScanner })));

const ICON_PROPS = { width: 22, height: 22, strokeWidth: 1.7, 'aria-hidden': true } as const;

/**
 * Native-only floating Scan action.
 *
 * Replaces NavFab now that Layout renders the same `MobileTabBar` on native
 * as web mobile — the tab bar already covers every destination NavFab used
 * to fan out to (plus Home/You, which NavFab never had). This FAB keeps only
 * the one action the tab bar can't: launching the camera scanner directly,
 * one tap, no intermediate menu. Renders nothing when the device can't scan
 * (a behavior change from NavFab, which always rendered the FAB shell).
 *
 * `position:absolute` inside `.app-shell` (a stable 100dvh box), not
 * `position:fixed`, so it never gets caught by the mobile URL-bar shift the
 * shell layout exists to avoid. Its `bottom` offset clears the tab bar that
 * now sits below it (see `.scan-fab-root` in responsive-nav.css).
 */
export function ScanFab() {
  const canScan = useCanScan();
  const importCards = useCollectionStore((s) => s.importCards);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const handleScanConfirm = async (text: string, count: number) => {
    setScannerOpen(false);
    setImporting(true);
    try {
      const { added, requested, fetchErrors } = await importScannedCards(text, count, importCards);
      // Cards are now committed to the collection — clear the persisted queue
      // so they don't reappear next time the scanner opens. Only on success:
      // a failed import (the catch below) keeps the queue so the user can retry.
      useScanQueueStore.getState().clear();
      const tail = added === requested ? '' : ` of ${requested.toLocaleString()}`;
      toast.show({
        message:
          `Added ${added.toLocaleString()}${tail} scanned card${added === 1 ? '' : 's'}` +
          (fetchErrors > 0
            ? ` · ${fetchErrors} couldn't be fetched — retry from the import page`
            : ''),
        tone: fetchErrors > 0 ? 'warn' : 'success',
      });
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "Couldn't save scanned cards.",
        tone: 'error',
      });
    } finally {
      setImporting(false);
    }
  };

  if (!canScan) return null;

  return (
    <div className="scan-fab-root">
      <button
        type="button"
        className="scan-fab-btn"
        aria-label="Scan cards"
        disabled={importing}
        onClick={() => setScannerOpen(true)}
      >
        <Camera {...ICON_PROPS} />
      </button>

      {scannerOpen && (
        <Suspense fallback={null}>
          <CardScanner
            onClose={() => setScannerOpen(false)}
            onConfirm={(text, count) => void handleScanConfirm(text, count)}
          />
        </Suspense>
      )}
    </div>
  );
}
