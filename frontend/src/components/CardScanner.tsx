import { logger } from '@/lib/logger';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronRight,
  Flashlight,
  FlashlightOff,
  Inbox,
  Plus,
  RotateCcw,
  Settings,
  X,
} from 'lucide-react';
import { CameraPreview } from '@capacitor-community/camera-preview';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useWakeLock } from '../lib/use-wake-lock';
import { getCardById } from '../lib/api';
import { isNativePlatform } from '../lib/platform';
import {
  playValueChime,
  priceTier,
  pulseValueHaptic,
  type CardValueTier,
} from '../lib/scanner-feedback';
import { detectCardBox } from '../lib/scanner-detect';
import { prewarm, scan } from '../lib/scanner/scan';
import type { Point } from '../lib/scanner/detect';
import { ScannerQueueSheet, type ScannedEntry } from './ScannerQueueSheet';
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
  const viewfinderRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** Off-screen canvas reused for every capture — avoids per-frame allocation. */
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Even smaller off-screen canvas for the detection loop. */
  const detectorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Previous detector frame, kept as raw grayscale for cheap pixel diffing. */
  const prevDetectorFrameRef = useRef<Uint8Array | null>(null);
  /** Consecutive stable+card-present detector ticks. */
  const stableFramesRef = useRef(0);
  /** Consecutive ticks with no card detected — used to drop the lock-on. */
  const lostFramesRef = useRef(0);
  /** Timestamp of the last capture firing, used for cooldown. */
  const lastFiredAtRef = useRef(0);
  /** rAF id for the detect loop. */
  const detectLoopRef = useRef<number | null>(null);
  /** Tracks whether a capture is currently in flight, so detector doesn't pile up. */
  const busyRef = useRef(false);
  /** Last successfully identified card id — used to dedupe back-to-back identical scans. */
  const lastIdRef = useRef<string | null>(null);
  /**
   * Detector is "armed" only after the frame has gone unstable (the user
   * moved the card / removed it). Prevents re-firing on the *same* still
   * card immediately after a successful identify.
   */
  const armedRef = useRef(true);

  const [status, setStatus] = useState<ScanStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [queue, setQueue] = useState<ScannedEntry[]>([]);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  /** Pulses the count badge briefly each time a new card lands. */
  const [pulseKey, setPulseKey] = useState(0);
  /**
   * Three rectangles, all in viewport (px) coordinates:
   *
   *   - `defaultViewfinderRect` — the static centred 5:7 box. Acts as a
   *     visual hint when nothing is detected, and as the fallback capture
   *     region when the card-edge detector turns up empty.
   *   - `searchRect` — the *full visible camera band* (minus a thin
   *     margin). The detector samples this region, NOT the viewfinder,
   *     so it can find cards held closer/further/off-centre.
   *   - `viewfinderRect` — what's actually displayed on screen and used
   *     by capture. Equals the detected card bbox when the detector has
   *     a lock, otherwise mirrors `defaultViewfinderRect`. CSS transitions
   *     this for a smooth "snap to the card" motion.
   */
  type Rect = { left: number; top: number; width: number; height: number };
  const [defaultViewfinderRect, setDefaultViewfinderRect] = useState<Rect | null>(null);
  const [searchRect, setSearchRect] = useState<Rect | null>(null);
  const [detectorBufSize, setDetectorBufSize] = useState<{ w: number; h: number }>({
    w: 75,
    h: 120,
  });
  const [viewfinderRect, setViewfinderRect] = useState<Rect | null>(null);
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
  } | null>(null);

  useLockBodyScroll();
  // Keep the screen awake while the scanner is open. A phone sleeping
  // mid-scan is the worst possible UX — losing camera state, dropping
  // queued cards, and forcing the user to unlock and reopen. Silently
  // no-ops on browsers without the Wake Lock API.
  useWakeLock(true);

  const totalCount = queue.reduce((sum, e) => sum + e.qty, 0);
  /**
   * Running market-value total of the staged queue (sum of qty × unit
   * USD price). Falls back to foil / etched when the regular usd field
   * is missing — Scryfall's convention. Memoised so the topbar pill
   * doesn't recalculate on every parent re-render.
   */
  const totalPrice = useMemo(() => {
    let sum = 0;
    for (const entry of queue) {
      const p = entry.card.prices;
      const raw = p?.usd ?? p?.usd_foil ?? p?.usd_etched ?? null;
      const value = raw ? Number.parseFloat(raw) : NaN;
      if (Number.isFinite(value)) sum += value * entry.qty;
    }
    return sum;
  }, [queue]);

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

      // If we don't have a detection lock currently, mirror the default
      // into the displayed viewfinder so a viewport resize doesn't
      // leave a stale outline behind.
      setViewfinderRect((current) => current ?? nextDefault);
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
   */
  const captureAndIdentify = useCallback(async () => {
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

      // Dedupe: the same card scanned twice in a row almost always means
      // the user is still framing the same physical card.
      if (lastIdRef.current === card.id) return;
      lastIdRef.current = card.id;

      const tier = priceTier(card);
      // Add to queue: bump qty if already present (keyed by oracle_id so
      // different printings of the same card collapse), else push new.
      setQueue((prev) => {
        const existing = prev.find((e) => e.id === card.oracle_id);
        if (existing) {
          return prev.map((e) => (e.id === card.oracle_id ? { ...e, qty: e.qty + 1 } : e));
        }
        return [
          ...prev,
          {
            id: card.oracle_id,
            card,
            qty: 1,
            rawText: card.name,
          },
        ];
      });
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
      setLastScan({ card, tier, key: Date.now() });
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
  }, [showHint, searchRect]);

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
      lostFramesRef.current = 0;
    };
  }, [status, sheetOpen, searchRect, defaultViewfinderRect, detectorBufSize, captureAndIdentify]);

  const removeFromQueue = (id: string) => {
    setQueue((prev) => prev.filter((s) => s.id !== id));
    lastIdRef.current = null;
  };

  const clearQueue = () => {
    setQueue([]);
    lastIdRef.current = null;
  };

  const changeQty = (id: string, delta: number) => {
    setQueue((prev) =>
      prev.map((e) => (e.id === id ? { ...e, qty: e.qty + delta } : e)).filter((e) => e.qty > 0)
    );
  };

  const changePrinting = (id: string, newCard: ScryfallCard) => {
    setQueue((prev) => prev.map((e) => (e.id === id ? { ...e, card: newCard } : e)));
  };

  const handleConfirm = useCallback(() => {
    if (queue.length === 0) return;
    const lines = queue.map(({ card, qty }) =>
      `${qty} ${card.name} (${card.set.toUpperCase()}) ${card.collector_number ?? ''}`.trim()
    );
    onConfirm(lines.join('\n'), totalCount);
  }, [queue, totalCount, onConfirm]);

  /**
   * "+1" on the bottom card panel: bumps the qty of the currently-shown
   * card. Useful when the user has several copies of the same printing
   * and the auto-detector keeps deduping them. Re-pulses the count
   * badge so the user sees the bump land.
   */
  const incrementLastScan = useCallback(() => {
    if (!lastScan) return;
    const oracleId = lastScan.card.oracle_id;
    setQueue((prev) => {
      const existing = prev.find((e) => e.id === oracleId);
      if (!existing) return prev;
      return prev.map((e) => (e.id === oracleId ? { ...e, qty: e.qty + 1 } : e));
    });
    setPulseKey((k) => k + 1);
    pulseValueHaptic(lastScan.tier);
  }, [lastScan]);

  const openSettings = useCallback(() => {
    // Placeholder — surface a stub message until the settings sheet lands.
    showHint('Scanner settings coming soon.', 1600);
  }, [showHint]);

  const scannerNode = (
    <div
      ref={rootRef}
      className="scanner-root"
      role="dialog"
      aria-label="Card scanner"
      aria-modal="true"
    >
      {!isNativePlatform() && <video ref={videoRef} className="scanner-video" playsInline muted />}

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
      {/* Keep the legacy viewfinder ref attached for any captureAndIdentify
          paths that still reference it; rendered invisible. */}
      {viewfinderRect && (
        <div
          ref={viewfinderRef}
          style={{
            position: 'absolute',
            left: `${viewfinderRect.left}px`,
            top: `${viewfinderRect.top}px`,
            width: `${viewfinderRect.width}px`,
            height: `${viewfinderRect.height}px`,
            display: 'none',
          }}
        />
      )}
      {/* Top-left close button. */}
      <button
        type="button"
        className="scanner-icon-btn scanner-close-btn"
        onClick={onClose}
        aria-label="Close scanner"
      >
        <X width={20} height={20} strokeWidth={1.8} />
      </button>

      {/* Top-center running total. Hidden when nothing has been scanned. */}
      {totalCount > 0 && (
        <div
          className="scanner-total-pill"
          role="status"
          aria-live="polite"
          aria-label={`Running total ${totalPrice.toFixed(2)} dollars`}
        >
          ${totalPrice.toFixed(2)}
        </div>
      )}

      {/* Top-right vertical action stack: queue (with badge), torch, settings.
          Wrapper provides the grouped-pill background; child buttons reuse
          `.scanner-icon-btn` (transparent inside the stack — see CSS). */}
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
        <button
          type="button"
          className="scanner-icon-btn"
          onClick={openSettings}
          aria-label="Scanner settings"
        >
          <Settings width={20} height={20} strokeWidth={1.8} />
        </button>
      </div>

      {hint && <div className="scanner-hint">{hint}</div>}

      {errorMsg && (
        <div className="scanner-error" role="alert">
          <p>{errorMsg}</p>
          <button type="button" className="btn" onClick={() => void startCamera()}>
            <RotateCcw width={14} height={14} strokeWidth={1.8} />
            <span>Retry</span>
          </button>
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
            const usd = lastScan.card.prices?.usd
              ? `$${Number.parseFloat(lastScan.card.prices.usd).toFixed(2)}`
              : null;
            const set = lastScan.card.set.toUpperCase();
            const collector = lastScan.card.collector_number ?? '—';
            const qty = queue.find((e) => e.id === lastScan.card.oracle_id)?.qty ?? 1;
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
                  <span className="scanner-card-panel-condition">Normal</span>
                  <span className="scanner-card-panel-set">
                    {set} · #{collector}
                  </span>
                  <span className="scanner-card-panel-lang">EN</span>
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
          onClose={() => setSheetOpen(false)}
          onChangePrinting={changePrinting}
          onChangeQty={changeQty}
          onRemove={removeFromQueue}
          onClearAll={clearQueue}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );

  // Portal to document.body so the scanner escapes the app's DOM tree. On
  // native that lets us hide #root while the camera-preview plugin's native
  // preview shows through the (transparent) WebView. On web it's harmless.
  return createPortal(scannerNode, document.body);
}
