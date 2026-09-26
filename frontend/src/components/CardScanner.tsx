import { logger } from '@/lib/logger';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
// Scanner + admin sheet ships with this lazy chunk (and AdminPage / YouPage), not the boot payload (E265).
import '@/styles/admin-scanner.css';
import {
  ChevronRight,
  Flashlight,
  FlashlightOff,
  Layers,
  Lightbulb,
  LoaderCircle,
  Plus,
  RotateCcw,
  Settings,
  X,
} from 'lucide-react';
import { focusInto, restoreFocus, trapTab, useOverlayLayer } from '../lib/overlay-layer';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useWakeLock } from '../lib/use-wake-lock';
import { getCardById } from '../lib/api';
import { formatMoney } from '../lib/format-money';
import { haptics } from '../lib/haptics';
import {
  CONDITIONS,
  FINISH_LABELS,
  availableFinishes,
  finishUnitPrice,
  playValueChime,
  priceTier,
  pulseValueHaptic,
  type CardValueTier,
} from '../lib/scanner-feedback';
import { conditionLabel, conditionShort } from './shared/CardRow';
import { SegmentedControl } from './shared/form';
import { Button, IconButton } from './shared/Button';
import { SelectMenu } from './SelectMenu';
import { detectCardBox } from '../lib/scanner-detect';
import { prewarm, scan } from '../lib/scanner/scan';
import type { Point } from '../lib/scanner/detect';
import { ScannerQueueSheet } from './ScannerQueueSheet';
import { ScannerEditSheet } from './ScannerEditSheet';
import { ScannerSettingsSheet } from './ScannerSettingsSheet';
import { rekeyedId, useScanQueue, useScanQueueStore } from '../lib/use-scan-queue';
import { useScannerSettings } from '../lib/scanner-settings';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Condition, Finish } from '../types';

/**
 * Compute the on-screen rectangle of the `object-fit: contain` video: the
 * whole camera frame, letterboxed inside the container (black bars above and
 * below on a phone). Capture and detection map viewport rects through this so
 * the cropped pixels stay aligned with what the user actually sees.
 */
function computeDisplayRect(
  vW: number,
  vH: number,
  cW: number,
  cH: number
): { dispX: number; dispY: number; dispW: number; dispH: number } {
  const videoAspect = vW / vH;
  const containerAspect = cW / cH;
  if (videoAspect > containerAspect) {
    const dispW = cW;
    const dispH = cW / videoAspect;
    return { dispX: 0, dispY: (cH - dispH) / 2, dispW, dispH };
  }
  const dispH = cH;
  const dispW = cH * videoAspect;
  return { dispX: (cW - dispW) / 2, dispY: 0, dispW, dispH };
}

interface Props {
  onClose: () => void;
  /**
   * Called when the user adds cards to the collection. Emits a text list
   * compatible with the `importText()` pipeline ("1 Name (SET) collector").
   * Resolve `true` once the cards are really in the collection: the scanner
   * then takes exactly those rows off its list. `false` (a failed import, or
   * a caller that only stages the text for review) leaves them in place.
   */
  onConfirm: (importText: string, count: number) => boolean | Promise<boolean>;
}

type ScanStatus = 'idle' | 'starting' | 'ready' | 'scanning' | 'error';

/** Aspect ratio of an MTG card: 2.5" x 3.5" = 5:7. */
const CARD_ASPECT = 5 / 7;

/**
 * Auto-detect tuning. The detector samples the *whole visible camera band*
 * at ~6 fps into a small grayscale buffer (sized to fit the visible aspect
 * ratio within `DETECT_BUDGET_PX` pixels — keeps cost roughly constant
 * across phone aspects). Each tick it:
 *
 *   1. Runs the card-edge detector (`detectCardBox`) over the buffer.
 *      If a plausible 5:7 rectangle is found, the on-screen outline
 *      snaps to it — so the user can hold a card closer, further, or
 *      off-centre and still get a clean crop.
 *   2. Frame-diffs vs the previous buffer to test stability.
 *   3. If stable for `STABLE_FRAMES_REQUIRED` consecutive ticks AND a
 *      card was just detected, fires `captureAndIdentify` using the
 *      detected bbox as the capture region. `CAPTURE_COOLDOWN_MS` plus
 *      the `armedRef` re-arm-on-motion guard prevent rapid re-fires
 *      on the same physical card.
 *
 * `DETECT_LOST_TICKS` is how many consecutive empty ticks must elapse
 * before we drop the locked-on outline back to the default centred
 * box — quick enough to feel responsive, slow enough to ride out a
 * single noisy frame.
 */
const DETECT_INTERVAL_MS = 140;
const DETECT_BUDGET_PX = 9000; // ~75×120 for a typical 9:19.5 portrait band
const STABILITY_THRESHOLD = 8; // mean absolute frame-diff per pixel (0–255)
const VARIANCE_THRESHOLD = 320; // stddev² of the title band when checked
/**
 * One stable, card-present tick is enough — `scan()` self-corrects by
 * thresholding cosine similarity. A low-confidence result is returned
 * as `miss` and the loop re-arms; we don't need a multi-frame gate
 * upstream to filter garbage.
 */
const STABLE_FRAMES_REQUIRED = 1;
const CAPTURE_COOLDOWN_MS = 800;
/** Consecutive failed capture attempts before the scanner offers a nudge.
 *  A single miss while the user lines up a card is normal and stays silent
 *  (the loop re-arms and tries again); only a sustained run of failures on
 *  the same card surfaces guidance. Keeps the overlay quiet-until-hit instead
 *  of flashing "didn't recognize" on every intermediate frame. */
const SUSTAINED_MISS_HINTS = 3;

export function CardScanner({ onClose, onConfirm }: Props) {
  // The scanner mounts only while it's open (every caller renders it
  // conditionally), so it registers for its whole lifetime.
  const { isTopmost } = useOverlayLayer();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** Off-screen canvas reused for every capture — avoids per-frame allocation. */
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Even smaller off-screen canvas for the detection loop. */
  const detectorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Previous detector frame, kept as raw grayscale for cheap pixel diffing. */
  const prevDetectorFrameRef = useRef<Uint8Array | null>(null);
  /** Consecutive stable+card-present detector ticks. */
  const stableFramesRef = useRef(0);
  /** Timestamp of the last capture firing, used for cooldown. */
  const lastFiredAtRef = useRef(0);
  /** rAF id for the detect loop. */
  const detectLoopRef = useRef<number | null>(null);
  /** Tracks whether a capture is currently in flight, so detector doesn't pile up. */
  const busyRef = useRef(false);
  /**
   * Detector is "armed" only after the frame has gone unstable (the user
   * moved the card / removed it). Prevents re-firing on the *same* still
   * card immediately after a successful identify.
   */
  const armedRef = useRef(true);
  /** Consecutive failed capture attempts, for the quiet-until-hit nudge. */
  const consecutiveMissRef = useRef(0);

  const {
    queue,
    totalCount,
    totalPrice,
    addScan,
    addManual,
    removeFromQueue,
    clearQueue,
    changeQty,
    changePrinting,
    changeFinish,
    changeCondition,
  } = useScanQueue();

  const [status, setStatus] = useState<ScanStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  /** The scanned-cards list. */
  const [sheetOpen, setSheetOpen] = useState(false);
  /** The row open in the edit sheet, from the list or the last-scan panel.
   *  Follows the row when a finish or printing change re-keys it. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Any sheet over the camera pauses auto-capture: a scan landing while
   *  someone is editing would move things under their thumb. */
  const sheetsOpen =
    sheetOpen || (editingId !== null && queue.some((e) => e.id === editingId)) || settingsOpen;
  const showTotal = useScannerSettings((s) => s.showTotal);
  /** Pulses the count badge briefly each time a new card lands. */
  const [pulseKey, setPulseKey] = useState(0);
  /**
   * Two rectangles, both in viewport (px) coordinates:
   *
   *   - `defaultViewfinderRect` — the static centred 5:7 box. Anchors the
   *     title-band variance probe when the detector has no lock, and is the
   *     fallback capture region when the card-edge detector turns up empty.
   *   - `searchRect` — the *full visible camera band* (minus a thin
   *     margin). The detector samples this region, NOT a card-shaped box,
   *     so it can find cards held closer/further/off-centre.
   */
  type Rect = { left: number; top: number; width: number; height: number };
  const [defaultViewfinderRect, setDefaultViewfinderRect] = useState<Rect | null>(null);
  const [searchRect, setSearchRect] = useState<Rect | null>(null);
  const [detectorBufSize, setDetectorBufSize] = useState<{ w: number; h: number }>({
    w: 75,
    h: 120,
  });
  /** Whether the detector currently has a lock — drives the "card found" styling. */
  const [hasLock, setHasLock] = useState(false);
  // Quad of the just-matched card in viewport coordinates (TL, TR, BR, BL).
  // Drawn as an SVG polygon overlay; cleared after the flash fades.
  const [matchedQuad, setMatchedQuad] = useState<Point[] | null>(null);
  /**
   * The most recently identified card. Stays on screen (in the bottom
   * panel) until the next successful scan replaces it — no auto-dismiss.
   * `key` is bumped on every scan so the CSS slide-in animation replays
   * even when the same card data lands twice in a row.
   */
  const [lastScan, setLastScan] = useState<{
    card: ScryfallCard;
    tier: CardValueTier;
    key: number;
    /** Composite queue-row id (printing id + finish) this scan landed in, so
     *  the panel's finish/qty controls target the exact row even after
     *  re-keying. */
    entryId: string;
  } | null>(null);

  useLockBodyScroll();
  // Keep the screen awake while the scanner is open. A phone sleeping
  // mid-scan is the worst possible UX — losing camera state, dropping
  // queued cards, and forcing the user to unlock and reopen. Silently
  // no-ops on browsers without the Wake Lock API.
  useWakeLock(true);

  // Track the hint's dismiss timer so a rapid scan doesn't accumulate stale
  // timers (F34): clear the previous before scheduling, and on unmount.
  const hintTimerRef = useRef<number | null>(null);
  const showHint = useCallback((msg: string, ms = 1800) => {
    if (hintTimerRef.current != null) window.clearTimeout(hintTimerRef.current);
    setHint(msg);
    hintTimerRef.current = window.setTimeout(() => {
      setHint((current) => (current === msg ? null : current));
      hintTimerRef.current = null;
    }, ms);
  }, []);
  useEffect(() => {
    return () => {
      if (hintTimerRef.current != null) window.clearTimeout(hintTimerRef.current);
    };
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    setStatus('starting');
    setErrorMsg(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera isn't available in this browser.");
      }
      // Ask for the full 4:3 sensor, in its own landscape terms. Mobile
      // browsers match width/height against the camera's native (landscape)
      // modes and then rotate frames to the screen, so 1920×1440 arrives as
      // 1440×1920 on a portrait phone. 4:3 is the whole sensor, the same view
      // as the phone's camera app; a 16:9 mode crops the sides off it.
      // Asking for a portrait size (1080×1920) made Chrome on Android crop a
      // tall slice out of the sensor and rotate that, which came back as a
      // narrow, zoomed landscape band on a portrait screen.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
          // Hint that we want close-up focus. Browsers that support these
          // advanced constraints (Chromium on Android primarily) will pick
          // continuous autofocus; iOS Safari ignores them silently and we
          // patch it up below via applyConstraints.
          advanced: [
            { focusMode: 'continuous' } as MediaTrackConstraintSet & { focusMode: string },
          ],
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      // Torch (flashlight) is only on a subset of devices. Probe
      // capabilities, and while we're here flip on continuous AF + auto
      // exposure / white balance where supported. These dramatically
      // sharpen the picked-up video on phones held close to a card — the
      // root cause of the "blurry through the camera" feeling was a fixed
      // focus distance picked at stream-start time.
      const track = stream.getVideoTracks()[0];
      // A browser that reads the constraints the other way round still hands
      // a portrait screen a landscape feed. Swap once for that case. Judge by
      // the frames the <video> actually shows, not track.getSettings(), which
      // some Android Chrome builds report unrotated; trusting it swapped a
      // correct stream into the zoomed one. This runs before the tuning
      // below, since applyConstraints replaces the set.
      const shown = videoRef.current;
      if (window.innerHeight > window.innerWidth && shown && shown.videoWidth > shown.videoHeight) {
        await track
          .applyConstraints({ width: { ideal: 1440 }, height: { ideal: 1920 } })
          .catch((e) => logger.warn('[scanner] could not re-orient camera:', e));
      }
      const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
        torch?: boolean;
        focusMode?: string[];
        exposureMode?: string[];
        whiteBalanceMode?: string[];
        zoom?: { min: number; max: number; step?: number };
      };
      setTorchSupported(Boolean(caps.torch));
      const tuneConstraints: MediaTrackConstraintSet[] = [];
      if (caps.focusMode?.includes('continuous')) {
        tuneConstraints.push({ focusMode: 'continuous' } as MediaTrackConstraintSet & {
          focusMode: string;
        });
      }
      if (caps.exposureMode?.includes('continuous')) {
        tuneConstraints.push({ exposureMode: 'continuous' } as MediaTrackConstraintSet & {
          exposureMode: string;
        });
      }
      if (caps.whiteBalanceMode?.includes('continuous')) {
        tuneConstraints.push({ whiteBalanceMode: 'continuous' } as MediaTrackConstraintSet & {
          whiteBalanceMode: string;
        });
      }
      // Force the widest possible field of view. Many phone browsers (iOS
      // Safari especially) hand the rear camera back at the system's
      // default zoom — which on multi-lens phones is often 2× — and
      // `object-fit: cover` then magnifies on top of that. Pinning to
      // the reported minimum (typically 1.0) is the single biggest
      // improvement to "way too zoomed in" complaints.
      if (caps.zoom && typeof caps.zoom.min === 'number') {
        tuneConstraints.push({ zoom: caps.zoom.min } as MediaTrackConstraintSet & {
          zoom: number;
        });
      }
      if (tuneConstraints.length > 0) {
        await track
          .applyConstraints({ advanced: tuneConstraints })
          .catch((e) => logger.warn('[scanner] could not tune camera:', e));
      }
      const settings = (track?.getSettings?.() ?? {}) as MediaTrackSettings & {
        zoom?: number;
        focusMode?: string;
      };
      logger.debug(
        `[scanner] camera: ${settings.width}×${settings.height} zoom=${settings.zoom ?? '?'} focus=${settings.focusMode ?? '?'}`
      );
      setStatus('ready');
      void prewarm();
    } catch (err) {
      logger.error('[scanner] camera failed:', err);
      const msg =
        err instanceof Error
          ? err.name === 'NotAllowedError'
            ? 'Camera permission denied. Enable it in your browser settings to scan cards.'
            : err.name === 'NotFoundError'
              ? 'No camera was found on this device.'
              : err.message
          : "Couldn't start the camera.";
      setErrorMsg(msg);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    // startCamera is async — every setState inside it runs in a later
    // microtask (after an await), so this isn't the synchronous cascade
    // the lint rule is guarding against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void startCamera();
    return () => {
      stopCamera();
      // v2 matcher state (opencv runtime + ORT session + DBs) is module-
      // singleton and persists across modal opens — no per-close teardown
      // beyond camera + raf cleanup.
      if (detectLoopRef.current !== null) cancelAnimationFrame(detectLoopRef.current);
    };
  }, [startCamera, stopCamera]);

  // Escape + Tab containment. The scanner predates both `<Modal>` and
  // `useSheetExit`, so it had a bare Escape handler and nothing else: Tab
  // walked straight out into the page behind it despite `aria-modal="true"`,
  // and a back navigation took the page out from
  // under a live camera. Same shared layer stack as Modal/useSheetExit, so a
  // dialog opened on top of the scanner is the one that answers a press.
  useEffect(() => {
    const root = rootRef.current;
    const prevFocused = document.activeElement as HTMLElement | null;
    if (root) focusInto(root);

    const onKey = (e: KeyboardEvent) => {
      if (!isTopmost()) return;
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (rootRef.current) trapTab(rootRef.current, e);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // Don't drop keyboard/screen-reader users at the top of the page when
      // the scanner closes.
      restoreFocus(prevFocused);
    };
  }, [onClose, isTopmost]);

  /**
   * Keep the viewfinder and search region in viewport coordinates, inside
   * the visible camera band. The preview is `object-fit: contain`: the whole
   * 4:3 frame, full width, with black bars above and below that hold the
   * corner controls and the last-scan panel, like a phone's camera app.
   * (Filling the screen instead cropped a third of the width off and read as
   * zoomed in.) A 5:7 portrait box sits centred in the band at ~78% of the
   * smaller axis. Capture and detection map these rects back into video
   * pixels through `computeDisplayRect`.
   */
  useEffect(() => {
    const video = videoRef.current;
    const root = rootRef.current;
    if (!root) return;

    const recompute = () => {
      const cW = root.clientWidth;
      const cH = root.clientHeight;
      if (!cW || !cH) return;
      // Wait for real frames: the band depends on the stream's size.
      if (!video?.videoWidth || !video.videoHeight) return;
      const band = computeDisplayRect(video.videoWidth, video.videoHeight, cW, cH);

      // Default viewfinder: a 5:7 portrait box at ~78% of the smaller
      // axis. The user sees this when nothing has been detected yet.
      const FILL = 0.78;
      let vfW: number;
      let vfH: number;
      if (band.dispW / band.dispH > CARD_ASPECT) {
        vfH = band.dispH * FILL;
        vfW = vfH * CARD_ASPECT;
      } else {
        vfW = band.dispW * FILL;
        vfH = vfW / CARD_ASPECT;
      }
      const nextDefault: Rect = {
        left: band.dispX + (band.dispW - vfW) / 2,
        top: band.dispY + (band.dispH - vfH) / 2,
        width: vfW,
        height: vfH,
      };
      setDefaultViewfinderRect(nextDefault);

      // Search region: almost the whole camera band (a 4% margin keeps the
      // frame edge out). The detector looks for a card anywhere inside this
      // rectangle, which is how the user can hover closer or further and
      // still get a hit.
      const INSET = 0.04;
      const nextSearch: Rect = {
        left: band.dispX + band.dispW * INSET,
        top: band.dispY + band.dispH * INSET,
        width: band.dispW * (1 - 2 * INSET),
        height: band.dispH * (1 - 2 * INSET),
      };
      setSearchRect(nextSearch);

      // Detector buffer size: keep total pixel count under
      // `DETECT_BUDGET_PX` but match the search-region aspect, so the
      // mapping back to viewport coords is a clean uniform scale.
      const aspect = nextSearch.width / nextSearch.height;
      const bufH = Math.max(40, Math.round(Math.sqrt(DETECT_BUDGET_PX / aspect)));
      const bufW = Math.max(40, Math.round(bufH * aspect));
      setDetectorBufSize({ w: bufW, h: bufH });
    };

    // `resize` fires when the stream's dimensions change: the re-orient
    // swap above, or the phone turning.
    const onMeta = () => recompute();
    if (video) {
      video.addEventListener('loadedmetadata', onMeta);
      video.addEventListener('resize', onMeta);
    }
    const ro = new ResizeObserver(() => recompute());
    ro.observe(root);
    recompute();

    return () => {
      if (video) {
        video.removeEventListener('loadedmetadata', onMeta);
        video.removeEventListener('resize', onMeta);
      }
      ro.disconnect();
    };
  }, [status]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet & { torch: boolean }],
      });
      setTorchOn(next);
    } catch {
      showHint('Torch not supported on this camera.');
    }
  }, [torchOn, showHint]);

  /**
   * Captures the viewfinder region, runs the v2 matcher (opencv quad
   * detect → CLAHE → pHash → MobileCLIP embedding rerank), and adds the
   * confidently-matched ScryfallCard to the queue with a value-tiered
   * chime + haptic. Borderline results (~0.70–0.85 cosine) are surfaced
   * as a hint for now — Phase E will replace that with a picker UI.
   *
   * `manual` marks a deliberate tap-to-rescan: it forces the add past the
   * back-to-back dedupe (so tapping the same card again increments it) and
   * always fires the success feedback.
   */
  const captureAndIdentify = useCallback(
    async (manual = false) => {
      if (busyRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      busyRef.current = true;
      setStatus('scanning');
      try {
        const root = rootRef.current;
        // Crop the wide SEARCH region (~92% of viewport), not the 5:7
        // viewfinder. The viewfinder is card-shaped, so when the user
        // lines up a card to fill it the card edges land on the crop
        // boundary and v2's opencv contour finder returns `no_quad`.
        // searchRect gives v2 a generous margin around the card.
        const rect = searchRect;
        if (!root || !rect) return;
        // Acquire a frame: the current frame of the playing <video>.
        const frameSource: CanvasImageSource = video;
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const cW = root.clientWidth;
        const cH = root.clientHeight;
        const { dispX, dispY, dispW } = computeDisplayRect(vw, vh, cW, cH);
        const scale = vw / dispW;
        const cardX = (rect.left - dispX) * scale;
        const cardY = (rect.top - dispY) * scale;
        const cardW = rect.width * scale;
        const cardH = rect.height * scale;

        if (!captureCanvasRef.current) captureCanvasRef.current = document.createElement('canvas');
        const canvas = captureCanvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error("Couldn't get canvas context.");

        // Render the viewfinder crop into a scratch canvas at raw-frame
        // resolution. The v2 pipeline does its own quad detection inside
        // this crop — opencv's contour finder picks up the actual card
        // edges (slight rotation, perspective) and warps to 488×680 before
        // hashing + embedding.
        canvas.width = Math.round(cardW);
        canvas.height = Math.round(cardH);
        ctx.drawImage(frameSource, cardX, cardY, cardW, cardH, 0, 0, canvas.width, canvas.height);

        const result = await scan({ source: canvas });

        if (result.kind === 'miss' || result.kind === 'borderline') {
          // Quiet-until-hit: a lone miss/ambiguous read while the user is still
          // lining the card up is normal — stay silent and let the loop re-arm
          // and try again. Only after several consecutive failures on the same
          // hold do we surface a calm, actionable nudge (never a raw score, and
          // never the old per-frame "didn't recognize" flash).
          logger.debug(
            result.kind === 'miss'
              ? `[scanner] miss: ${result.reason} ${result.detail ?? ''}`
              : `[scanner] borderline: top ${result.candidates[0]?.scryfallId}`
          );
          consecutiveMissRef.current += 1;
          if (consecutiveMissRef.current >= SUSTAINED_MISS_HINTS) {
            const noCard = result.kind === 'miss' && result.reason === 'no_quad';
            showHint(
              noCard
                ? 'Center a card in the frame, in good light.'
                : "Can't read this card. Try better light or lay it flat.",
              2200
            );
          }
          return;
        }

        // Confident: resolve the matcher's UUID to a full ScryfallCard.
        const card = await getCardById(result.match.scryfallId);
        if (!card) {
          logger.warn(
            `[scanner] confident match for ${result.match.scryfallId} but card fetch failed`
          );
          showHint("Found a match but couldn't load the card. Try again.", 2200);
          return;
        }

        // A confident read (even a dedupe) clears the sustained-miss streak.
        consecutiveMissRef.current = 0;

        // Dedupe-or-add. The hook owns the dedupe cursor; 'duplicate'
        // means the same printing was just scanned, so the matcher is
        // still locked on the same physical card. Skip the feedback, but
        // say how to add another copy: holding up a second copy of the card
        // you just scanned is exactly when someone needs to know, every time,
        // not once per session. A manual tap forces past the dedupe.
        if (addScan(card, manual) === 'duplicate') {
          showHint('Already added. Tap the screen to add another copy.', 2600);
          return;
        }

        const tier = priceTier(card);
        setPulseKey((k) => k + 1);
        if (useScannerSettings.getState().sound) playValueChime(tier);
        pulseValueHaptic(tier);
        // Map v2's detected quad (in crop-canvas coords, since we drew the
        // searchRect crop into the canvas at native frame resolution) back
        // to viewport coords. The inverse simplifies to:
        //   viewport = canvas / scale + rect.{left,top}
        // because cardX = (rect.left - dispX) * scale and canvas size
        // matches cardW × cardH. Draw the flash outline at the actual
        // card corners — TL/TR/BR/BL, in that order from orderQuadCorners.
        const viewportQuad: Point[] = result.quad.map((p) => ({
          x: p.x / scale + rect.left,
          y: p.y / scale + rect.top,
        }));
        setMatchedQuad(viewportQuad);
        setHasLock(true);
        window.setTimeout(() => {
          setHasLock(false);
          setMatchedQuad(null);
        }, 700);
        // Bottom card panel: persistent — stays until the next successful
        // scan replaces it. `key` is bumped on every scan so the slide-in
        // animation replays even when the same card lands twice.
        // A scan lands as the settings' default finish, clamped to the
        // printing; track that row's key so the panel's controls act on it.
        setLastScan({
          card,
          tier,
          key: Date.now(),
          entryId: rekeyedId(card, useScannerSettings.getState().defaultFinish),
        });
      } catch (err) {
        logger.error('[scanner] capture failed:', err);
        showHint('Scan failed. Try again.');
      } finally {
        busyRef.current = false;
        setStatus('ready');
        lastFiredAtRef.current = performance.now();
        stableFramesRef.current = 0;
        armedRef.current = false; // re-arm only after the next unstable frame
      }
    },
    [addScan, showHint, searchRect]
  );

  /**
   * Auto-detect loop. Samples the viewfinder region at ~6 fps into a tiny
   * grayscale buffer, computes (a) frame-diff stability vs the previous
   * tick and (b) variance over the title band. When both gates pass for
   * `STABLE_FRAMES_REQUIRED` consecutive ticks, fires `captureAndIdentify`.
   * The `armedRef` gate forces the user to move the card after each
   * successful capture before another can fire.
   */
  useEffect(() => {
    if (status === 'error' || sheetsOpen) return;
    if (!searchRect || !defaultViewfinderRect) return;

    let lastTick = 0;
    const bufW = detectorBufSize.w;
    const bufH = detectorBufSize.h;

    const sampleDetectorFrame = async (): Promise<Uint8Array | null> => {
      if (!detectorCanvasRef.current) {
        detectorCanvasRef.current = document.createElement('canvas');
      }
      const dCanvas = detectorCanvasRef.current;
      if (dCanvas.width !== bufW || dCanvas.height !== bufH) {
        dCanvas.width = bufW;
        dCanvas.height = bufH;
      }
      const dCtx = dCanvas.getContext('2d', { willReadFrequently: true });
      if (!dCtx) return null;

      const root = rootRef.current;
      if (!root) return null;
      const cW = root.clientWidth;
      const cH = root.clientHeight;
      if (!cW || !cH) return null;

      let frameSource: CanvasImageSource | null = null;
      let vw = 0;
      let vh = 0;
      {
        const video = videoRef.current;
        if (!video || video.readyState < 2) return null;
        frameSource = video;
        vw = video.videoWidth;
        vh = video.videoHeight;
      }
      if (!frameSource || !vw || !vh) return null;

      const { dispX, dispY, dispW } = computeDisplayRect(vw, vh, cW, cH);
      const scale = vw / dispW;
      const sx = (searchRect.left - dispX) * scale;
      const sy = (searchRect.top - dispY) * scale;
      const sw = searchRect.width * scale;
      const sh = searchRect.height * scale;
      try {
        dCtx.drawImage(frameSource, sx, sy, sw, sh, 0, 0, bufW, bufH);
      } catch {
        return null;
      }
      const { data } = dCtx.getImageData(0, 0, bufW, bufH);
      const out = new Uint8Array(bufW * bufH);
      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        out[j] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0;
      }
      return out;
    };

    let cancelled = false;
    const tick = async (ts: number) => {
      detectLoopRef.current = requestAnimationFrame(tick);
      if (cancelled) return;
      if (ts - lastTick < DETECT_INTERVAL_MS) return;
      lastTick = ts;
      if (busyRef.current) return;
      if (status !== 'ready') return;

      const frame = await sampleDetectorFrame();
      if (cancelled || !frame) return;

      // Card-edge detection: kept only for the title-band variance
      // location below — its old job (driving the on-screen lockbox)
      // produced false-positive locks on noise and jumpy outlines that
      // didn't match the actual card shape. The visible reticle is now
      // a static 5:7 guide; v2's own opencv contour finder decides
      // whether the captured frame contains a real card.
      const detected = detectCardBox(frame, bufW, bufH);

      const prev = prevDetectorFrameRef.current;
      prevDetectorFrameRef.current = frame;
      if (!prev || prev.length !== frame.length) return;

      // Frame-diff stability: mean abs delta per pixel.
      let diffSum = 0;
      for (let i = 0; i < frame.length; i++) {
        const d = frame[i] - prev[i];
        diffSum += d < 0 ? -d : d;
      }
      const meanDiff = diffSum / frame.length;
      const isStable = meanDiff < STABILITY_THRESHOLD;

      // Title-band variance — gates whether capture fires. The band's
      // position depends on where the card actually is:
      //   - Locked: top ~12% of the detected bbox in the detector frame.
      //   - Unlocked: top ~12% of the DEFAULT VIEWFINDER region, mapped
      //     into detector coords. Critical: the detector frame now
      //     samples the full search region, so naively sampling the top
      //     of the whole frame would always be background — variance
      //     would fail and capture would never fire (this was the
      //     regression after the search-region expansion).
      let bandX0: number;
      let bandY0: number;
      let bandX1: number;
      let bandY1: number;
      if (detected) {
        bandX0 = detected.x;
        bandY0 = detected.y;
        bandX1 = detected.x + detected.w;
        bandY1 = detected.y + Math.max(1, Math.round(detected.h * 0.12));
      } else {
        const vfX = ((defaultViewfinderRect.left - searchRect.left) / searchRect.width) * bufW;
        const vfY = ((defaultViewfinderRect.top - searchRect.top) / searchRect.height) * bufH;
        const vfW = (defaultViewfinderRect.width / searchRect.width) * bufW;
        const vfH = (defaultViewfinderRect.height / searchRect.height) * bufH;
        bandX0 = Math.max(0, Math.floor(vfX));
        bandY0 = Math.max(0, Math.floor(vfY));
        bandX1 = Math.min(bufW, Math.ceil(vfX + vfW));
        bandY1 = Math.min(bufH, Math.ceil(vfY + Math.max(1, vfH * 0.12)));
      }
      let bandSum = 0;
      let bandCount = 0;
      for (let y = bandY0; y < bandY1; y++) {
        const rowOffset = y * bufW;
        for (let x = bandX0; x < bandX1; x++) {
          bandSum += frame[rowOffset + x];
          bandCount++;
        }
      }
      const bandMean = bandCount > 0 ? bandSum / bandCount : 0;
      let bandVar = 0;
      for (let y = bandY0; y < bandY1; y++) {
        const rowOffset = y * bufW;
        for (let x = bandX0; x < bandX1; x++) {
          const d = frame[rowOffset + x] - bandMean;
          bandVar += d * d;
        }
      }
      bandVar = bandCount > 0 ? bandVar / bandCount : 0;
      // Auto-capture requires both detector lock AND a high-variance
      // title band. Lock alone could trigger on any rectangular thing;
      // variance alone could trigger on a card held in the default
      // centered region even when the detector hasn't found edges.
      // Together they mean "we know where the card is AND it actually
      // has text where the title should be".
      // Auto-fire on variance + stability alone — the upstream gradient-
      // projection lock was producing false-positive crops that v2's quad
      // finder couldn't recognize. v2 handles "is this a card?" itself
      // via its own opencv contour detector; the upstream `detected` flag
      // remains useful only for visual lockbox feedback.
      const hasCard = bandVar > VARIANCE_THRESHOLD;

      if (!isStable) {
        armedRef.current = true;
        stableFramesRef.current = 0;
        return;
      }
      if (!hasCard || !armedRef.current) {
        stableFramesRef.current = 0;
        return;
      }
      stableFramesRef.current += 1;
      if (
        stableFramesRef.current >= STABLE_FRAMES_REQUIRED &&
        ts - lastFiredAtRef.current > CAPTURE_COOLDOWN_MS
      ) {
        void captureAndIdentify();
      }
    };

    detectLoopRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (detectLoopRef.current !== null) {
        cancelAnimationFrame(detectLoopRef.current);
        detectLoopRef.current = null;
      }
      prevDetectorFrameRef.current = null;
      stableFramesRef.current = 0;
    };
  }, [status, sheetsOpen, searchRect, defaultViewfinderRect, detectorBufSize, captureAndIdentify]);

  /**
   * Add rows to the collection: every row, or the ones picked in select mode.
   * Emits MTGA-style lines with a finish token, then a condition token, both
   * *before* the (SET) group, which is where the text parser's cleanName()
   * looks for them, so the chosen finish and condition round-trip to the
   * collection (E87). NM is never emitted: it's the unmarked default.
   *
   * The caller reports whether the add went through. Only then are exactly
   * these rows taken off the list, read from the store directly because the
   * caller closes the scanner before its import resolves. A failed add keeps
   * them for a retry, and adding a selection leaves the rest for next time.
   */
  const handleConfirm = useCallback(
    async (ids?: string[]) => {
      const rows = ids ? queue.filter((e) => ids.includes(e.id)) : queue;
      if (rows.length === 0) return;
      const lines = rows.map(({ card, qty, finish, condition }) => {
        const finishToken = finish === 'foil' ? ' *F*' : finish === 'etched' ? ' *ETCHED*' : '';
        const conditionValue = condition ?? 'nm';
        const conditionToken =
          conditionValue !== 'nm' ? ` *${conditionShort(conditionValue)}*` : '';
        return `${qty} ${card.name}${finishToken}${conditionToken} (${card.set.toUpperCase()}) ${
          card.collector_number ?? ''
        }`.trim();
      });
      const count = rows.reduce((n, e) => n + e.qty, 0);
      const added = await onConfirm(lines.join('\n'), count);
      if (added) useScanQueueStore.getState().remove(rows.map((e) => e.id));
    },
    [queue, onConfirm]
  );

  /** Keep the edit sheet and the last-scan panel pointed at a row that a
   *  finish or printing change just re-keyed. */
  const followRow = useCallback((oldId: string, newId: string, card: ScryfallCard) => {
    setEditingId((cur) => (cur === oldId ? newId : cur));
    setLastScan((prev) =>
      prev && prev.entryId === oldId ? { ...prev, card, entryId: newId } : prev
    );
  }, []);

  const handleRemove = useCallback(
    (ids: string[]) => {
      removeFromQueue(ids);
      setLastScan((prev) => (prev && ids.includes(prev.entryId) ? null : prev));
      setEditingId((cur) => (cur && ids.includes(cur) ? null : cur));
    },
    [removeFromQueue]
  );

  const handleBulkFinish = useCallback(
    (ids: string[], finish: Finish) => {
      changeFinish(ids, finish);
      setLastScan((prev) =>
        prev && ids.includes(prev.entryId)
          ? { ...prev, entryId: rekeyedId(prev.card, finish) }
          : prev
      );
    },
    [changeFinish]
  );

  /**
   * "1 more" on the last-scan panel: bumps the qty of the row it shows (its
   * exact printing and finish). The fast path for a stack of the same card,
   * which the auto-detector deliberately won't re-add.
   */
  const incrementLastScan = useCallback(() => {
    if (!lastScan) return;
    changeQty(lastScan.entryId, 1);
    setPulseKey((k) => k + 1);
    pulseValueHaptic(lastScan.tier);
  }, [lastScan, changeQty]);

  /** Clearing the list also clears the panel: `lastScan` is local to the
   *  scanner, so wiping the queue alone would leave a stale card on screen. */
  const handleClearAll = useCallback(() => {
    clearQueue();
    setLastScan(null);
  }, [clearQueue]);

  /**
   * A card added by name. Camera accepts get their value-tiered chime and
   * haptic above; a deliberate add skips the celebration but still confirms
   * with the plain success cue.
   */
  const handleAddManual = useCallback(
    (card: ScryfallCard) => {
      addManual(card);
      haptics.success();
    },
    [addManual]
  );

  // Camera is actually up. The corner chrome only makes sense over a live
  // preview; over the black "starting" screen it reads as orphan icons.
  const cameraLive = status === 'ready' || status === 'scanning';
  const starting = status === 'idle' || status === 'starting';
  const firstCard = cameraLive && totalCount === 0 && !lastScan;
  const editing = editingId ? queue.find((e) => e.id === editingId) : undefined;
  const panelEntry = lastScan ? queue.find((e) => e.id === lastScan.entryId) : undefined;

  const scannerNode = (
    // data-theme pins the camera screen dark whatever the app theme is, so
    // the form-kit controls on the last-scan panel read against the camera.
    // The sheets portal to <body> and follow the app theme like every sheet.
    <div
      ref={rootRef}
      className="scanner-root"
      data-theme="obsidian"
      role="dialog"
      aria-label="Card scanner"
      aria-modal="true"
    >
      <video ref={videoRef} className="scanner-video" playsInline muted />

      {/* Tap-to-rescan surface. A transparent full-bleed button *below* the
          corner chrome: tapping bare camera forces a capture, which is how
          to add another copy of the card just scanned (the auto loop
          deliberately won't). Gated to `ready` so it can't fire mid-capture. */}
      {status === 'ready' && (
        <button
          type="button"
          className="scanner-capture-surface"
          aria-label="Tap to scan the card in view"
          onClick={() => void captureAndIdentify(true)}
        />
      )}

      {/* Before the first card: a frame guide, so a first-time user knows
          what to do. It goes once anything is scanned; the matcher finds a
          card anywhere in view, so the guide is a hint, not a boundary. */}
      {firstCard && defaultViewfinderRect && (
        <div
          className="scanner-guide"
          aria-hidden="true"
          style={{
            left: defaultViewfinderRect.left,
            top: defaultViewfinderRect.top,
            width: defaultViewfinderRect.width,
            height: defaultViewfinderRect.height,
          }}
        >
          <span />
          <span />
          <span />
          <span />
        </div>
      )}

      {/* On a match, an outline at the card's actual corners (TL/TR/BR/BL
          from the matcher): perspective-correct, no jumping. */}
      {hasLock && matchedQuad && matchedQuad.length === 4 && (
        <svg className="scanner-overlay" aria-hidden="true">
          <polygon points={matchedQuad.map((p) => `${p.x},${p.y}`).join(' ')} />
        </svg>
      )}

      {cameraLive && (
        <div className="scanner-topbar">
          <IconButton
            className="scanner-icon-btn"
            label="Close scanner"
            title={false}
            icon={<X width={20} height={20} strokeWidth={1.8} />}
            onClick={onClose}
          />

          {/* The count always shows; it's how a booster box keeps rhythm.
              The value is a setting. */}
          <div className="scanner-tally" role="status" aria-live="polite">
            {totalCount > 0 && (
              <>
                {showTotal && <b>{formatMoney(totalPrice)}</b>}
                <span>
                  {totalCount} card{totalCount === 1 ? '' : 's'}
                </span>
              </>
            )}
          </div>

          <div className="scanner-tools">
            {torchSupported && (
              <IconButton
                className={torchOn ? 'scanner-icon-btn active' : 'scanner-icon-btn'}
                label={torchOn ? 'Turn torch off' : 'Turn torch on'}
                title={false}
                icon={
                  torchOn ? (
                    <Flashlight width={20} height={20} strokeWidth={1.8} />
                  ) : (
                    <FlashlightOff width={20} height={20} strokeWidth={1.8} />
                  )
                }
                onClick={toggleTorch}
              />
            )}
            <IconButton
              className="scanner-icon-btn"
              label="Scanner settings"
              title={false}
              icon={<Settings width={20} height={20} strokeWidth={1.8} />}
              onClick={() => setSettingsOpen(true)}
            />
            <button
              type="button"
              className="scanner-icon-btn"
              onClick={() => setSheetOpen(true)}
              aria-label={totalCount > 0 ? `Scanned cards, ${totalCount}` : 'Scanned cards'}
            >
              <Layers width={20} height={20} strokeWidth={1.8} />
              {totalCount > 0 && (
                <span key={pulseKey} className="scanner-stack-badge">
                  {totalCount}
                </span>
              )}
            </button>
          </div>
        </div>
      )}

      {cameraLive && (hint || firstCard) && (
        <div className="scanner-hint" role="status" aria-live="polite">
          <Lightbulb width={14} height={14} strokeWidth={2} aria-hidden />
          {hint ?? 'Hold a card flat inside the frame'}
        </div>
      )}

      {/* Starting state, over the black screen before the preview is live.
          Carries its own Cancel so there's always an exit. */}
      {starting && (
        <div className="scanner-starting" role="status" aria-live="polite">
          <LoaderCircle
            className="scanner-starting-spinner"
            width={34}
            height={34}
            strokeWidth={1.8}
            aria-hidden
          />
          <p>Starting camera…</p>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      )}

      {errorMsg && (
        <div className="scanner-error" role="alert">
          <p>{errorMsg}</p>
          <div className="scanner-error-actions">
            <Button onClick={onClose} icon={<X width={14} height={14} strokeWidth={1.8} />}>
              Close
            </Button>
            <Button
              variant="primary"
              onClick={() => void startCamera()}
              icon={<RotateCcw width={14} height={14} strokeWidth={1.8} />}
            >
              Retry
            </Button>
          </div>
        </div>
      )}

      {firstCard && (
        <p className="scanner-card-panel scanner-card-panel-empty">
          Cards you scan show up here. Scanning starts on its own.
        </p>
      )}

      {/* The last-scan panel: the card just read, its price, and its finish
          and condition as real pickers showing every option. Stays until the
          next scan replaces it. Tap the card to edit everything. */}
      {lastScan &&
        (() => {
          const card = panelEntry?.card ?? lastScan.card;
          const img = card.image_uris?.small || card.card_faces?.[0]?.image_uris?.small;
          const qty = panelEntry?.qty ?? 1;
          const finish = panelEntry?.finish ?? 'nonfoil';
          const finishes = availableFinishes(card.finishes);
          const condition = panelEntry?.condition ?? 'nm';
          const unit = finishUnitPrice(card.prices, finish);
          return (
            <div key={lastScan.key} className={`scanner-card-panel tier-${lastScan.tier}`}>
              <button
                type="button"
                className="scanner-card-panel-main"
                onClick={() => panelEntry && setEditingId(panelEntry.id)}
                aria-label={`Edit ${card.name}`}
              >
                <span className="scanner-card-panel-thumb">
                  {img ? <img src={img} alt="" /> : null}
                </span>
                <span className="scanner-card-panel-body">
                  <span className="scanner-card-panel-name">
                    {qty > 1 && <span className="scanner-card-panel-qty">{qty}× </span>}
                    {card.name}
                  </span>
                  <span className="scanner-card-panel-set">
                    {card.set_name} · #{card.collector_number ?? '—'}
                  </span>
                </span>
                <span className="scanner-card-panel-price">
                  <b>{unit != null ? formatMoney(unit) : '—'}</b>
                  <span>Market</span>
                </span>
                <ChevronRight
                  className="scanner-card-panel-chevron"
                  width={18}
                  height={18}
                  strokeWidth={1.8}
                  aria-hidden
                />
              </button>
              {panelEntry && (
                <div className="scanner-card-panel-meta">
                  {finishes.length > 1 && (
                    <SegmentedControl<Finish>
                      ariaLabel={`Finish of ${card.name}`}
                      value={finish}
                      options={finishes.map((f) => ({ value: f, label: FINISH_LABELS[f] }))}
                      onChange={(f) => {
                        changeFinish(panelEntry.id, f);
                        followRow(panelEntry.id, rekeyedId(card, f), card);
                      }}
                    />
                  )}
                  <SelectMenu<string>
                    className="scanner-card-panel-condition"
                    ariaLabel={`Condition of ${card.name}`}
                    value={condition}
                    options={CONDITIONS.map((c) => ({
                      value: c,
                      label: conditionLabel(c),
                      triggerLabel: conditionShort(c),
                    }))}
                    onChange={(c) => changeCondition(panelEntry.id, c as Condition)}
                  />
                  <button
                    type="button"
                    className="scanner-card-panel-add"
                    onClick={incrementLastScan}
                    aria-label={`Add another ${card.name}`}
                  >
                    <Plus width={14} height={14} strokeWidth={2.4} aria-hidden />1
                  </button>
                </div>
              )}
            </div>
          );
        })()}

      {sheetOpen && (
        <ScannerQueueSheet
          entries={queue}
          onClose={() => setSheetOpen(false)}
          onEdit={setEditingId}
          onRemove={handleRemove}
          onClearAll={handleClearAll}
          onChangeFinish={handleBulkFinish}
          onChangeCondition={changeCondition}
          onAddCard={handleAddManual}
          onConfirm={(ids) => void handleConfirm(ids)}
        />
      )}

      {editing && (
        <ScannerEditSheet
          entry={editing}
          onClose={() => setEditingId(null)}
          onFinish={(f) => {
            changeFinish(editing.id, f);
            followRow(editing.id, rekeyedId(editing.card, f), editing.card);
          }}
          onCondition={(c) => changeCondition(editing.id, c)}
          onQty={(d) => changeQty(editing.id, d)}
          onPrinting={(card) => {
            changePrinting(editing.id, card);
            followRow(editing.id, rekeyedId(card, editing.finish), card);
          }}
          onRemove={() => handleRemove([editing.id])}
        />
      )}

      {settingsOpen && <ScannerSettingsSheet onClose={() => setSettingsOpen(false)} />}
    </div>
  );

  // Portal to <body> so the full-screen overlay escapes any ancestor's
  // containing block.
  return createPortal(scannerNode, document.body);
}
