import { logger } from '@/lib/logger';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronRight,
  Flashlight,
  FlashlightOff,
  Inbox,
  LoaderCircle,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react';
import { CameraPreview } from '@capacitor-community/camera-preview';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useWakeLock } from '../lib/use-wake-lock';
import { getCardById } from '../lib/api';
import { formatMoney } from '../lib/format-money';
import { isNativePlatform } from '../lib/platform';
import {
  FINISH_LABELS,
  availableFinishes,
  finishUnitPrice,
  nextFinish,
  playValueChime,
  priceTier,
  pulseValueHaptic,
  type CardValueTier,
} from '../lib/scanner-feedback';
import { detectCardBox } from '../lib/scanner-detect';
import { prewarm, scan } from '../lib/scanner/scan';
import type { Point } from '../lib/scanner/detect';
import { ScannerQueueSheet } from './ScannerQueueSheet';
import { entryKey, useScanQueue } from '../lib/use-scan-queue';
import type { ScryfallCard } from '@/deck-builder/types';

/**
 * Compute the on-screen rectangle of the visible video band given a fit mode.
 * `contain` letterboxes (rect may be smaller than the container);
 * `cover` fills the container (rect may extend outside it — dispX/dispY can
 * be negative). The capture and viewfinder math both branch on this so the
 * cropped pixels stay aligned with what the user actually sees.
 */
function computeDisplayRect(
  vW: number,
  vH: number,
  cW: number,
  cH: number,
  fit: 'contain' | 'cover'
): { dispX: number; dispY: number; dispW: number; dispH: number } {
  const videoAspect = vW / vH;
  const containerAspect = cW / cH;
  const fillsWidth =
    fit === 'contain' ? videoAspect > containerAspect : videoAspect < containerAspect;
  if (fillsWidth) {
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
  /** Called when the user taps "Add N cards". Emits a text list compatible
   *  with the existing `importText()` pipeline ("1 Name (SET) collector"). */
  onConfirm: (importText: string, count: number) => void;
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

export function CardScanner({ onClose, onConfirm }: Props) {
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
  /** Whether the one-time "tap to add another" hint has been shown this session. */
  const tapHintShownRef = useRef(false);

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
  } = useScanQueue();

  const [status, setStatus] = useState<ScanStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  /**
   * When set, the queue sheet opens with this entry's printing picker
   * already expanded. Wired to the panel's set·# tap so "change the
   * printing" is one tap, not "open sheet → find row → tap Printing".
   */
  const [pickerFor, setPickerFor] = useState<string | null>(null);
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
    /** Composite queue-row id (oracle_id + finish) this scan landed in, so the
     *  panel's finish/qty controls target the exact row even after re-keying. */
    entryId: string;
  } | null>(null);

  useLockBodyScroll();
  // Keep the screen awake while the scanner is open. A phone sleeping
  // mid-scan is the worst possible UX — losing camera state, dropping
  // queued cards, and forcing the user to unlock and reopen. Silently
  // no-ops on browsers without the Wake Lock API.
  useWakeLock(true);

  const showHint = useCallback((msg: string, ms = 1800) => {
    setHint(msg);
    window.setTimeout(() => setHint((current) => (current === msg ? null : current)), ms);
  }, []);

  const stopCamera = useCallback(() => {
    if (isNativePlatform()) {
      void CameraPreview.stop().catch(() => {
        /* idempotent — fine to ignore if already stopped */
      });
      document.documentElement.classList.remove('scanner-active');
      return;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    setStatus('starting');
    setErrorMsg(null);
    if (isNativePlatform()) {
      try {
        await CameraPreview.start({
          position: 'rear',
          // Render the native preview behind the (transparent) WebView so
          // the HTML overlay (viewfinder, hints, controls) layers on top.
          toBack: true,
          disableAudio: true,
          // Lock to portrait — we don't want the preview rotating mid-scan,
          // and the viewfinder geometry assumes a portrait viewport.
          lockAndroidOrientation: true,
        });
        document.documentElement.classList.add('scanner-active');
        setStatus('ready');
        void prewarm();
      } catch (err) {
        logger.error('[scanner] native preview failed:', err);
        const msg = err instanceof Error ? err.message : 'Could not start the camera.';
        setErrorMsg(msg);
        setStatus('error');
      }
      return;
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera is not available in this browser.');
      }
      // Request a portrait-oriented stream. Phone cameras are physically
      // landscape sensors, but browsers will crop/rotate to match the
      // requested aspect — without this hint we get a 16:9 landscape feed
      // that `object-fit: cover` then crops aggressively in portrait
      // viewports (the "zoomed in" complaint). Asking for 1080×1920 makes
      // the displayed frame match the screen much more closely.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1080 },
          height: { ideal: 1920 },
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
          : 'Could not start the camera.';
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * Keep the on-screen viewfinder sized to live inside the *visible*
   * camera area. With `object-fit: contain` the video gets letterboxed
   * when the stream aspect doesn't match the container — we want the
   * framing rectangle to fit inside the visible video band, not the
   * whole viewport.
   *
   * The math is plain "contain-fit": video either fills width or fills
   * height of the container, whichever produces a fully-visible image.
   * Once we know the displayed rect we drop a 5:7 portrait box centred
   * inside it at ~78% of the smaller axis.
   */
  useEffect(() => {
    const video = videoRef.current;
    const root = rootRef.current;
    if (!root) return;

    const recompute = () => {
      const cW = root.clientWidth;
      const cH = root.clientHeight;
      if (!cW || !cH) return;

      // On native the preview cover-fits the sensor to the screen, so the
      // visible band IS the screen — no need to consult video.videoWidth
      // (which doesn't exist anyway, there's no <video> element).
      let dispX: number;
      let dispY: number;
      let dispW: number;
      let dispH: number;
      if (isNativePlatform()) {
        dispX = 0;
        dispY = 0;
        dispW = cW;
        dispH = cH;
      } else {
        if (!video) return;
        const vW = video.videoWidth;
        const vH = video.videoHeight;
        if (!vW || !vH) return;
        ({ dispX, dispY, dispW, dispH } = computeDisplayRect(vW, vH, cW, cH, 'contain'));
      }
      const fit: 'contain' | 'cover' = isNativePlatform() ? 'cover' : 'contain';

      const visW = fit === 'cover' ? cW : dispW;
      const visH = fit === 'cover' ? cH : dispH;
      const visX = fit === 'cover' ? 0 : dispX;
      const visY = fit === 'cover' ? 0 : dispY;

      // Default viewfinder: a 5:7 portrait box at ~78% of the smaller
      // axis. The user sees this when nothing has been detected yet.
      const FILL = 0.78;
      let vfW: number;
      let vfH: number;
      if (visW / visH > CARD_ASPECT) {
        vfH = visH * FILL;
        vfW = vfH * CARD_ASPECT;
      } else {
        vfW = visW * FILL;
        vfH = vfW / CARD_ASPECT;
      }
      const nextDefault: Rect = {
        left: visX + (visW - vfW) / 2,
        top: visY + (visH - vfH) / 2,
        width: vfW,
        height: vfH,
      };
      setDefaultViewfinderRect(nextDefault);

      // Search region: almost the full visible band (leave a 4% margin
      // so chrome / safe-area insets don't bleed in). The detector
      // looks for a card anywhere inside this rectangle — that's how
      // the user can hover closer or further and still get a hit.
      const INSET = 0.04;
      const nextSearch: Rect = {
        left: visX + visW * INSET,
        top: visY + visH * INSET,
        width: visW * (1 - 2 * INSET),
        height: visH * (1 - 2 * INSET),
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

    const onMeta = () => recompute();
    if (video) video.addEventListener('loadedmetadata', onMeta);
    const ro = new ResizeObserver(() => recompute());
    ro.observe(root);
    recompute();

    return () => {
      if (video) video.removeEventListener('loadedmetadata', onMeta);
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
      const native = isNativePlatform();
      const video = videoRef.current;
      if (!native && (!video || video.readyState < 2)) return;
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
        // Acquire a frame: on native this is a still snapshot from the live
        // preview; on web it's the current frame of the playing <video>.
        let frameSource: CanvasImageSource;
        let vw: number;
        let vh: number;
        if (native) {
          const { value } = await CameraPreview.captureSample({ quality: 85 });
          const frameImg = new Image();
          frameImg.src = `data:image/jpeg;base64,${value}`;
          await (frameImg.decode?.() ??
            new Promise<void>((resolve) => (frameImg.onload = () => resolve())));
          frameSource = frameImg;
          vw = frameImg.naturalWidth;
          vh = frameImg.naturalHeight;
        } else {
          frameSource = video!;
          vw = video!.videoWidth;
          vh = video!.videoHeight;
        }
        const cW = root.clientWidth;
        const cH = root.clientHeight;
        const fit = isNativePlatform() ? 'cover' : 'contain';
        const { dispX, dispY, dispW } = computeDisplayRect(vw, vh, cW, cH, fit);
        const scale = vw / dispW;
        const cardX = (rect.left - dispX) * scale;
        const cardY = (rect.top - dispY) * scale;
        const cardW = rect.width * scale;
        const cardH = rect.height * scale;

        if (!captureCanvasRef.current) captureCanvasRef.current = document.createElement('canvas');
        const canvas = captureCanvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Could not get canvas context.');

        // Render the viewfinder crop into a scratch canvas at raw-frame
        // resolution. The v2 pipeline does its own quad detection inside
        // this crop — opencv's contour finder picks up the actual card
        // edges (slight rotation, perspective) and warps to 488×680 before
        // hashing + embedding.
        canvas.width = Math.round(cardW);
        canvas.height = Math.round(cardH);
        ctx.drawImage(frameSource, cardX, cardY, cardW, cardH, 0, 0, canvas.width, canvas.height);

        const result = await scan({ source: canvas });

        if (result.kind === 'miss') {
          const msg =
            result.reason === 'no_quad'
              ? "Couldn't find a card edge — try better lighting."
              : "Didn't recognize this card — try again.";
          logger.debug(`[scanner] miss: ${result.reason} ${result.detail ?? ''}`);
          showHint(msg, 2200);
          return;
        }

        if (result.kind === 'borderline') {
          // Phase E target: surface a picker with `result.candidates` so the
          // user can pick the printing themselves. For now, treat as a soft
          // miss with diagnostic text — auto-adding a low-confidence card
          // would silently pollute the queue.
          const top = result.candidates[0];
          logger.debug(
            `[scanner] borderline: top ${top.scryfallId} conf=${top.confidence.toFixed(2)}`
          );
          showHint(`Ambiguous match (${top.confidence.toFixed(2)}) — try again.`, 2200);
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

        // Dedupe-or-add. The hook owns the dedupe cursor; 'duplicate'
        // means the same printing was just scanned, so the matcher is
        // still locked on the same physical card — silently skip the
        // feedback side effects too. A manual tap forces past the dedupe so
        // the user can intentionally add another copy of the same card.
        if (addScan(card, manual) === 'duplicate') return;

        const tier = priceTier(card);
        setPulseKey((k) => k + 1);
        playValueChime(tier);
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
        // Scans always land as the nonfoil row (the matcher can't read finish);
        // track that row's key so the panel's toggle/+1 act on the right row.
        setLastScan({ card, tier, key: Date.now(), entryId: entryKey(card.oracle_id, 'nonfoil') });
        // Teach tap-to-rescan once: the auto loop won't re-add the same card, so
        // surface how to add another copy the first time a scan lands.
        if (!tapHintShownRef.current) {
          tapHintShownRef.current = true;
          showHint('Same card again? Tap the screen to add another.', 2800);
        }
      } catch (err) {
        logger.error('[scanner] capture failed:', err);
        showHint('Scan failed — try again.');
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
    if (status === 'error' || sheetOpen) return;
    if (!searchRect || !defaultViewfinderRect) return;

    let lastTick = 0;
    const native = isNativePlatform();
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
      if (native) {
        // Native: pull a small snapshot. captureSample is the only frame
        // grab the plugin exposes — quality 40 keeps it cheap.
        try {
          const { value } = await CameraPreview.captureSample({ quality: 40 });
          const img = new Image();
          img.src = `data:image/jpeg;base64,${value}`;
          await (img.decode?.() ?? new Promise<void>((resolve) => (img.onload = () => resolve())));
          frameSource = img;
          vw = img.naturalWidth;
          vh = img.naturalHeight;
        } catch {
          return null;
        }
      } else {
        const video = videoRef.current;
        if (!video || video.readyState < 2) return null;
        frameSource = video;
        vw = video.videoWidth;
        vh = video.videoHeight;
      }
      if (!frameSource || !vw || !vh) return null;

      const fit = native ? 'cover' : 'contain';
      const { dispX, dispY, dispW } = computeDisplayRect(vw, vh, cW, cH, fit);
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
  }, [status, sheetOpen, searchRect, defaultViewfinderRect, detectorBufSize, captureAndIdentify]);

  const handleConfirm = useCallback(() => {
    if (queue.length === 0) return;
    // Emit MTGA-style lines with a finish token *before* the (SET) group —
    // that's where the text parser's cleanName() looks for *F* / *ETCHED*,
    // so the chosen finish round-trips to the collection as a foil/etched copy.
    const lines = queue.map(({ card, qty, finish }) => {
      const token = finish === 'foil' ? ' *F*' : finish === 'etched' ? ' *ETCHED*' : '';
      return `${qty} ${card.name}${token} (${card.set.toUpperCase()}) ${
        card.collector_number ?? ''
      }`.trim();
    });
    onConfirm(lines.join('\n'), totalCount);
  }, [queue, totalCount, onConfirm]);

  /**
   * "+1" on the bottom card panel: bumps the qty of the currently-shown
   * row (its exact oracle+finish). Useful when the user has several copies
   * of the same card and the auto-detector keeps deduping them. Re-pulses
   * the count badge and fires haptic feedback; a no-op if the row was since
   * removed, but the button still confirms the press.
   */
  const incrementLastScan = useCallback(() => {
    if (!lastScan) return;
    changeQty(lastScan.entryId, 1);
    setPulseKey((k) => k + 1);
    pulseValueHaptic(lastScan.tier);
  }, [lastScan, changeQty]);

  /**
   * "Clear all" also dismisses the bottom card panel. The panel's `lastScan`
   * is local to the scanner (not part of the queue), so wiping the queue alone
   * would leave a stale card lingering on screen.
   */
  const handleClearAll = useCallback(() => {
    clearQueue();
    setLastScan(null);
  }, [clearQueue]);

  // Camera is actually up. The corner chrome (close, total, queue/torch) only
  // makes sense over a live preview — rendering it over the black "starting"
  // screen looks like floating orphan icons, so gate it on this.
  const cameraLive = status === 'ready' || status === 'scanning';
  const starting = status === 'idle' || status === 'starting';

  const scannerNode = (
    <div
      ref={rootRef}
      className="scanner-root"
      role="dialog"
      aria-label="Card scanner"
      aria-modal="true"
    >
      {!isNativePlatform() && <video ref={videoRef} className="scanner-video" playsInline muted />}

      {/* Tap-to-rescan surface (native only). A transparent full-bleed button
          sitting *below* the corner chrome (z-index): tapping bare camera
          forces a capture — letting the user intentionally add another copy
          of the same card, which the auto loop deliberately won't. Taps on
          the close/queue/torch/panel controls land on those (higher z) instead.
          Gated to `ready` so it doesn't fire mid-capture or during errors. */}
      {isNativePlatform() && status === 'ready' && (
        <button
          type="button"
          className="scanner-capture-surface"
          aria-label="Tap to scan the card in view"
          onClick={() => void captureAndIdentify(true)}
        />
      )}

      {/* No persistent outline — the camera is "always looking" and the
          v2 matcher (its own opencv contour finder) handles rotation,
          distance, and off-center placement on its own. When a card is
          matched, we draw a quad polygon at the actual TL/TR/BR/BL
          corners returned by v2 — perspective-correct, no jumping. */}
      {hasLock && matchedQuad && matchedQuad.length === 4 && (
        <svg
          className="scanner-overlay"
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        >
          <polygon
            points={matchedQuad.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="rgba(80, 200, 120, 0.15)"
            stroke="rgba(80, 220, 130, 0.95)"
            strokeWidth={3}
            strokeLinejoin="round"
            style={{ transition: 'opacity 220ms ease-out' }}
          />
        </svg>
      )}
      {/* Top-left close button — only once the camera is live (the
          starting/error overlays carry their own exit). */}
      {cameraLive && (
        <button
          type="button"
          className="scanner-icon-btn scanner-close-btn"
          onClick={onClose}
          aria-label="Close scanner"
        >
          <X width={20} height={20} strokeWidth={1.8} />
        </button>
      )}

      {/* Top-center running total. Hidden when nothing has been scanned. */}
      {cameraLive && totalCount > 0 && (
        <div
          className="scanner-total-pill"
          role="status"
          aria-live="polite"
          aria-label={`Running total ${totalPrice.toFixed(2)} dollars`}
        >
          {formatMoney(totalPrice)}
        </div>
      )}

      {/* Top-right vertical action stack: queue (with badge), torch.
          Wrapper provides the grouped-pill background; child buttons reuse
          `.scanner-icon-btn` (transparent inside the stack — see CSS). */}
      {cameraLive && (
        <div className="scanner-action-stack">
          <button
            type="button"
            className="scanner-icon-btn"
            onClick={() => setSheetOpen(true)}
            aria-label={
              totalCount > 0
                ? `Review ${totalCount} scanned card${totalCount === 1 ? '' : 's'}`
                : 'Open scan queue'
            }
          >
            <Inbox width={20} height={20} strokeWidth={1.8} />
            {totalCount > 0 && (
              <span key={pulseKey} className="scanner-stack-badge">
                {totalCount}
              </span>
            )}
          </button>
          {torchSupported && (
            <button
              type="button"
              className={`scanner-icon-btn${torchOn ? ' active' : ''}`}
              onClick={toggleTorch}
              aria-label={torchOn ? 'Turn torch off' : 'Turn torch on'}
            >
              {torchOn ? (
                <Flashlight width={20} height={20} strokeWidth={1.8} />
              ) : (
                <FlashlightOff width={20} height={20} strokeWidth={1.8} />
              )}
            </button>
          )}
        </div>
      )}

      {cameraLive && hint && (
        <div className="scanner-hint" role="status" aria-live="polite">
          {hint}
        </div>
      )}

      {/* Starting state — shown over the black screen before the preview is
          live, so the corner chrome doesn't float over nothing. Carries its
          own Cancel so there's always an exit. */}
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
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="scanner-error" role="alert">
          <p>{errorMsg}</p>
          <div className="scanner-error-actions">
            <button type="button" className="btn" onClick={onClose}>
              <X width={14} height={14} strokeWidth={1.8} />
              <span>Close</span>
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void startCamera()}>
              <RotateCcw width={14} height={14} strokeWidth={1.8} />
              <span>Retry</span>
            </button>
          </div>
        </div>
      )}

      {/* Bottom card panel — persistent, replaces transient toast.
          Shows the most-recently identified card; tapping the arrow
          opens the full review sheet. */}
      {lastScan && (
        <div
          key={lastScan.key}
          className={`scanner-card-panel tier-${lastScan.tier}`}
          role="status"
          aria-live="polite"
        >
          {(() => {
            const img =
              lastScan.card.image_uris?.small ||
              lastScan.card.image_uris?.normal ||
              lastScan.card.card_faces?.[0]?.image_uris?.small;
            const set = lastScan.card.set.toUpperCase();
            const collector = lastScan.card.collector_number ?? '—';
            const entry = queue.find((e) => e.id === lastScan.entryId);
            const qty = entry?.qty ?? 1;
            // Finish is owned by the queue entry; the panel reflects (and edits)
            // it live so the price shown matches what will be imported.
            const finish = entry?.finish ?? 'nonfoil';
            const finishes = availableFinishes(lastScan.card.finishes);
            const canToggleFinish = finishes.length > 1;
            const unit = finishUnitPrice(lastScan.card.prices, finish);
            const usd = unit != null ? formatMoney(unit) : null;
            return (
              <>
                <button
                  type="button"
                  className="scanner-card-panel-main"
                  onClick={() => setSheetOpen(true)}
                  aria-label={`Review ${lastScan.card.name}`}
                >
                  <div className="scanner-card-panel-thumb">
                    {img ? <img src={img} alt="" /> : null}
                  </div>
                  <div className="scanner-card-panel-body">
                    <div className="scanner-card-panel-name">{lastScan.card.name}</div>
                    <div className="scanner-card-panel-price">
                      <span className="scanner-card-panel-market">MARKET</span>
                      <span className="scanner-card-panel-amount">{usd ?? '—'}</span>
                    </div>
                  </div>
                  <ChevronRight
                    className="scanner-card-panel-chevron"
                    width={18}
                    height={18}
                    strokeWidth={1.8}
                  />
                </button>
                <div className="scanner-card-panel-meta">
                  {canToggleFinish && (
                    <button
                      type="button"
                      className={`scanner-card-panel-finish finish-${finish}`}
                      onClick={() => {
                        const next = nextFinish(finish, finishes);
                        changeFinish(lastScan.entryId, next);
                        // The row re-keys on finish change; keep the panel
                        // pointed at it so the price/qty stay in sync.
                        setLastScan((prev) =>
                          prev ? { ...prev, entryId: entryKey(prev.card.oracle_id, next) } : prev
                        );
                      }}
                      aria-label={`Finish: ${FINISH_LABELS[finish]}. Tap to change.`}
                    >
                      {FINISH_LABELS[finish]}
                    </button>
                  )}
                  <button
                    type="button"
                    className="scanner-card-panel-set"
                    onClick={() => {
                      setPickerFor(lastScan.entryId);
                      setSheetOpen(true);
                    }}
                    aria-label={`Change printing of ${lastScan.card.name}`}
                  >
                    {set} · #{collector}
                  </button>
                  <button
                    type="button"
                    className="scanner-card-panel-add"
                    onClick={incrementLastScan}
                    aria-label={`Add another ${lastScan.card.name}`}
                  >
                    <Plus width={14} height={14} strokeWidth={2.4} />
                    <span>{qty}</span>
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {sheetOpen && (
        <ScannerQueueSheet
          entries={queue}
          initialPickerFor={pickerFor}
          onClose={() => {
            setSheetOpen(false);
            setPickerFor(null);
          }}
          onChangePrinting={changePrinting}
          onChangeQty={changeQty}
          onChangeFinish={changeFinish}
          onRemove={removeFromQueue}
          onClearAll={handleClearAll}
          onConfirm={handleConfirm}
          onAddCard={addManual}
        />
      )}
    </div>
  );

  // Portal to document.body so the scanner escapes the app's DOM tree. On
  // native that lets us hide #root while the camera-preview plugin's native
  // preview shows through the (transparent) WebView. On web it's harmless.
  return createPortal(scannerNode, document.body);
}
