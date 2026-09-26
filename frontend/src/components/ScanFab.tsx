import { Camera } from 'lucide-react';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useCanScan } from '../lib/use-can-scan';
import { useMediaQuery } from '../lib/use-media-query';
import { useCollectionStore } from '../store/collection';
import { toast } from '../store/toasts';
import { importScannedCards } from '../lib/scan-import';
import { fetchErrorMessage } from '../lib/import-review';

import { userMessage } from '@/lib/user-error';
const CardScanner = lazy(() => import('./CardScanner').then((m) => ({ default: m.CardScanner })));

const ICON_PROPS = { width: 22, height: 22, strokeWidth: 1.7, 'aria-hidden': true } as const;

/** Same boundary as the CSS phone tier. */
const PHONE = '(max-width: 600px)';
/** Scroll this far in one direction before the button reacts, so a finger's
 *  jitter at rest doesn't flicker it. */
const SCROLL_SLOP_PX = 8;
/** Within this much of the top the button always shows. */
const NEAR_TOP_PX = 80;

/**
 * Floating Scan action.
 *
 * The tab bar already covers every destination, so this FAB keeps only the one
 * action it can't: launching the camera scanner directly, one tap, no
 * intermediate menu. Renders nothing when the device can't scan.
 *
 * `position:absolute` inside `.app-shell` (a stable 100dvh box), not
 * `position:fixed`, so it never gets caught by the mobile URL-bar shift the
 * shell layout exists to avoid. Its `bottom` offset clears the tab bar that
 * now sits below it (see `.scan-fab-root` in responsive-nav.css).
 *
 * Where and when (T135, STYLE_GUIDE § Layout system): only on the collection
 * pages, where a scan lands, and only on a phone; a tablet reaches the scanner
 * through Add cards. It floats over the right edge of the content, which is
 * where prices sit, so it steps aside while the page scrolls down (that is
 * when you are reading) and comes back on the way up or near the top.
 */
export function ScanFab({ scrollEl }: { scrollEl?: HTMLElement | null }) {
  const canScan = useCanScan();
  const phone = useMediaQuery(PHONE);
  const onCollection = useLocation().pathname.startsWith('/collection');
  const importCards = useCollectionStore((s) => s.importCards);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [tucked, setTucked] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!scrollEl) return;
    let last = scrollEl.scrollTop;
    const onScroll = () => {
      const y = scrollEl.scrollTop;
      const delta = y - last;
      if (Math.abs(delta) < SCROLL_SLOP_PX) return;
      last = y;
      // A focused button stays put: tucking it would strand keyboard focus
      // on something that can't be seen.
      if (document.activeElement === buttonRef.current) return;
      setTucked(delta > 0 && y > NEAR_TOP_PX);
    };
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollEl.removeEventListener('scroll', onScroll);
  }, [scrollEl]);

  /** Resolves true once the cards are in the collection, so the scanner takes
   *  those rows off its list. A failed import keeps them for a retry. */
  const handleScanConfirm = async (text: string, count: number): Promise<boolean> => {
    setScannerOpen(false);
    setImporting(true);
    try {
      const { added, requested, fetchErrors } = await importScannedCards(text, count, importCards);
      const tail = added === requested ? '' : ` of ${requested.toLocaleString()}`;
      toast.show({
        message:
          `Added ${added.toLocaleString()}${tail} scanned card${added === 1 ? '' : 's'}` +
          (fetchErrors > 0
            ? ` · ${fetchErrorMessage(fetchErrors, 'Retry from the import page.')}`
            : ''),
        tone: fetchErrors > 0 ? 'warn' : 'success',
      });
      return true;
    } catch (err) {
      toast.show({
        message: userMessage(err, "Couldn't save scanned cards."),
        tone: 'error',
      });
      return false;
    } finally {
      setImporting(false);
    }
  };

  const showButton = phone && onCollection;
  // An open scanner outlives the button (a route change under it must not
  // unmount the camera mid-scan).
  if (!canScan || (!showButton && !scannerOpen)) return null;

  return (
    <div className="scan-fab-root">
      {showButton && (
        <button
          ref={buttonRef}
          type="button"
          className={`scan-fab-btn${tucked ? ' is-tucked' : ''}`}
          aria-label="Scan cards"
          disabled={importing}
          onClick={() => setScannerOpen(true)}
        >
          <Camera {...ICON_PROPS} />
        </button>
      )}

      {scannerOpen && (
        <Suspense fallback={null}>
          <CardScanner onClose={() => setScannerOpen(false)} onConfirm={handleScanConfirm} />
        </Suspense>
      )}
    </div>
  );
}
