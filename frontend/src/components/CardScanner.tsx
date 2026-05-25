import { logger } from '@/lib/logger';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Camera,
  ChevronRight,
  Flashlight,
  FlashlightOff,
  RotateCcw,
  ScanLine,
  X,
} from 'lucide-react';
import { CameraPreview } from '@capacitor-community/camera-preview';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { identifyCard } from '../lib/api';
import { disposeOcr, recognizeText, warmOcr } from '../lib/ocr';
import { isNativePlatform } from '../lib/platform';
import { playValueChime, priceTier, pulseValueHaptic } from '../lib/scanner-feedback';
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
 * Title strip occupies roughly the top 4–11% of an MTG card's height, with
 * the name running from ~8% to ~72% of the width (mana symbols on the right).
 * These crops were tuned against modern, modern-foil, old-frame, and showcase
 * frames — the band is wide enough to tolerate small misalignment.
 */
const TITLE_CROP = { x: 0.07, y: 0.038, w: 0.66, h: 0.075 };

/**
 * Auto-detect tuning. The detector samples the viewfinder at ~6 fps into a
 * tiny grayscale buffer and fires capture when (a) the frame is stable for
 * `STABLE_FRAMES_REQUIRED` consecutive ticks and (b) the title band has
 * enough pixel variance to plausibly contain a card name. The variance gate
 * suppresses triggers over plain backgrounds (a hand, an empty table, a
 * binder page corner). `CAPTURE_COOLDOWN_MS` gives the user time to swap
 * physical cards without firing twice on the same one — combined with the
 * `lastIdRef` dedupe, that's enough to keep auto-trigger calm.
 */
const DETECT_INTERVAL_MS = 165;
const DETECT_W = 64;
const DETECT_H = 90;
const STABILITY_THRESHOLD = 7; // mean absolute frame-diff per pixel (0–255)
const VARIANCE_THRESHOLD = 380; // stddev² of the title band on the detector frame
const STABLE_FRAMES_REQUIRED = 2;
const CAPTURE_COOLDOWN_MS = 1100;

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
  /** Pulses the count pill briefly each time a new card lands. */
  const [pulseKey, setPulseKey] = useState(0);
  /**
   * The viewfinder is sized in JS to live INSIDE the visible camera area.
   * Earlier iterations sized it as a percentage of the viewport, which on
   * phones (where the camera feed gets letterboxed) meant the framing box
   * extended way past the actual visible video. Now we compute the
   * displayed video rectangle from the stream's aspect ratio and the
   * container size, then place a 5:7 card-shaped box centred inside it.
   * The same rectangle is used directly as the capture region (see
   * captureAndIdentify) so what you see is exactly what gets cropped.
   */
  const [viewfinderRect, setViewfinderRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  useLockBodyScroll();

  const totalCount = queue.reduce((sum, e) => sum + e.qty, 0);

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
        warmOcr();
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
      warmOcr();
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
      void disposeOcr();
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

      // 5:7 portrait card. Cap to ~78% of the smaller axis of the visible
      // viewport — leaves enough margin for the user to recognise the box
      // and to see their fingers framing the card. In cover mode the
      // visible viewport IS the container; in contain mode it's the
      // letterboxed video band.
      const FILL = 0.78;
      const visW = fit === 'cover' ? cW : dispW;
      const visH = fit === 'cover' ? cH : dispH;
      const visX = fit === 'cover' ? 0 : dispX;
      const visY = fit === 'cover' ? 0 : dispY;
      let vfW: number;
      let vfH: number;
      if (visW / visH > CARD_ASPECT) {
        vfH = visH * FILL;
        vfW = vfH * CARD_ASPECT;
      } else {
        vfW = visW * FILL;
        vfH = vfW / CARD_ASPECT;
      }
      setViewfinderRect({
        left: visX + (visW - vfW) / 2,
        top: visY + (visH - vfH) / 2,
        width: vfW,
        height: vfH,
      });
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
   * Captures a single video frame, OCRs the card's title strip with
   * Tesseract (or ML Kit on native), and resolves the recognised text via
   * Scryfall's fuzzy `cards/named` endpoint. The recognised card is added
   * to the queue (or its qty bumped if already present), and a value-
   * tiered chime + haptic plays so the user gets feedback without having
   * to look at the screen.
   */
  const captureAndIdentify = useCallback(async () => {
    if (busyRef.current) return;
    const native = isNativePlatform();
    const video = videoRef.current;
    if (!native && (!video || video.readyState < 2)) return;
    busyRef.current = true;
    setStatus('scanning');
    try {
      // Crop region in *raw frame* coords = the on-screen viewfinder
      // rectangle, mapped through the same fit-rect math as the recompute
      // effect. This guarantees the cropped pixels are exactly what the
      // user saw inside the viewfinder box.
      const root = rootRef.current;
      const viewfinder = viewfinderRef.current;
      if (!root || !viewfinder || !viewfinderRect) {
        return;
      }
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
      const cardX = (viewfinderRect.left - dispX) * scale;
      const cardY = (viewfinderRect.top - dispY) * scale;
      const cardW = viewfinderRect.width * scale;
      const cardH = viewfinderRect.height * scale;

      if (!captureCanvasRef.current) captureCanvasRef.current = document.createElement('canvas');
      const canvas = captureCanvasRef.current;

      // Crop the card's title strip, OCR it, and resolve via Scryfall's
      // fuzzy `cards/named` endpoint. 3x scale because Tesseract is happier
      // with bigger inputs and tight phone-camera crops are often soft.
      const titleX = cardX + cardW * TITLE_CROP.x;
      const titleY = cardY + cardH * TITLE_CROP.y;
      const titleW = cardW * TITLE_CROP.w;
      const titleH = cardH * TITLE_CROP.h;
      const SCALE = 3;
      canvas.width = Math.round(titleW * SCALE);
      canvas.height = Math.round(titleH * SCALE);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Could not get canvas context.');
      ctx.drawImage(frameSource, titleX, titleY, titleW, titleH, 0, 0, canvas.width, canvas.height);

      // Light preprocessing: grayscale + contrast boost around the mean.
      // A cheap stand-in for adaptive thresholding that meaningfully
      // improves OCR on warm/yellow card frames.
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = img.data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        data[i] = data[i + 1] = data[i + 2] = g;
        sum += g;
      }
      const mean = sum / (data.length / 4);
      for (let i = 0; i < data.length; i += 4) {
        const v = data[i];
        const boosted = Math.max(0, Math.min(255, (v - mean) * 1.8 + mean));
        data[i] = data[i + 1] = data[i + 2] = boosted;
      }
      ctx.putImageData(img, 0, 0);

      const { text, confidence } = await recognizeText(canvas);
      if (!text || text.length < 2) return;
      if (confidence < 35) return;

      const card = await identifyCard(text);
      if (!card) return;

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
            rawText: text,
          },
        ];
      });
      setPulseKey((k) => k + 1);
      playValueChime(tier);
      pulseValueHaptic(tier);
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
  }, [showHint, viewfinderRect]);

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
    if (!viewfinderRect) return;

    let lastTick = 0;
    const native = isNativePlatform();

    const sampleDetectorFrame = async (): Promise<Uint8Array | null> => {
      if (!detectorCanvasRef.current) {
        detectorCanvasRef.current = document.createElement('canvas');
        detectorCanvasRef.current.width = DETECT_W;
        detectorCanvasRef.current.height = DETECT_H;
      }
      const dCanvas = detectorCanvasRef.current;
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
      const sx = (viewfinderRect.left - dispX) * scale;
      const sy = (viewfinderRect.top - dispY) * scale;
      const sw = viewfinderRect.width * scale;
      const sh = viewfinderRect.height * scale;
      try {
        dCtx.drawImage(frameSource, sx, sy, sw, sh, 0, 0, DETECT_W, DETECT_H);
      } catch {
        return null;
      }
      const { data } = dCtx.getImageData(0, 0, DETECT_W, DETECT_H);
      const out = new Uint8Array(DETECT_W * DETECT_H);
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
      const prev = prevDetectorFrameRef.current;
      prevDetectorFrameRef.current = frame;
      if (!prev || prev.length !== frame.length) return;

      // Frame-diff: mean abs delta per pixel. Cheap and surprisingly robust.
      let diffSum = 0;
      for (let i = 0; i < frame.length; i++) {
        const d = frame[i] - prev[i];
        diffSum += d < 0 ? -d : d;
      }
      const meanDiff = diffSum / frame.length;

      // Title-band variance: stddev² of the top ~12% of the detector frame.
      // A card title has letterforms = high variance; a hand or table = low.
      const bandH = Math.max(1, Math.round(DETECT_H * 0.12));
      const bandPixels = DETECT_W * bandH;
      let bandSum = 0;
      for (let i = 0; i < bandPixels; i++) bandSum += frame[i];
      const bandMean = bandSum / bandPixels;
      let bandVar = 0;
      for (let i = 0; i < bandPixels; i++) {
        const d = frame[i] - bandMean;
        bandVar += d * d;
      }
      bandVar /= bandPixels;

      const isStable = meanDiff < STABILITY_THRESHOLD;
      const hasCard = bandVar > VARIANCE_THRESHOLD;

      if (!isStable) {
        // Movement re-arms the detector — required so the same card can't
        // re-fire immediately after a successful capture.
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
  }, [status, sheetOpen, viewfinderRect, captureAndIdentify]);

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

  const handleConfirm = () => {
    if (queue.length === 0) return;
    const lines = queue.map(({ card, qty }) =>
      `${qty} ${card.name} (${card.set.toUpperCase()}) ${card.collector_number ?? ''}`.trim()
    );
    onConfirm(lines.join('\n'), totalCount);
  };

  const scannerNode = (
    <div
      ref={rootRef}
      className="scanner-root"
      role="dialog"
      aria-label="Card scanner"
      aria-modal="true"
    >
      {!isNativePlatform() && <video ref={videoRef} className="scanner-video" playsInline muted />}

      <div className="scanner-overlay" aria-hidden="true">
        <div
          ref={viewfinderRef}
          className="scanner-viewfinder"
          style={
            viewfinderRect
              ? {
                  position: 'absolute',
                  left: `${viewfinderRect.left}px`,
                  top: `${viewfinderRect.top}px`,
                  width: `${viewfinderRect.width}px`,
                  height: `${viewfinderRect.height}px`,
                }
              : { display: 'none' }
          }
        >
          <div className="scanner-viewfinder-corner tl" />
          <div className="scanner-viewfinder-corner tr" />
          <div className="scanner-viewfinder-corner bl" />
          <div className="scanner-viewfinder-corner br" />
          <div className="scanner-title-band" />
          {status === 'scanning' && <div className="scanner-scanline" />}
        </div>
      </div>

      <header className="scanner-topbar">
        <button
          type="button"
          className="scanner-icon-btn"
          onClick={onClose}
          aria-label="Close scanner"
        >
          <X width={20} height={20} strokeWidth={1.8} />
        </button>
        {totalCount > 0 ? (
          <button
            type="button"
            className="scanner-count-pill"
            onClick={() => setSheetOpen(true)}
            aria-label={`Review ${totalCount} scanned card${totalCount === 1 ? '' : 's'}`}
          >
            <span key={pulseKey} className="scanner-count-pill-num">
              {totalCount}
            </span>
            <span className="scanner-count-pill-label">scanned · {queue.length} unique</span>
            <ChevronRight width={14} height={14} strokeWidth={2} />
          </button>
        ) : (
          <div className="scanner-status">
            <ScanLine width={14} height={14} strokeWidth={1.8} />
            <span>Hold a card inside the box</span>
          </div>
        )}
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
      </header>

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

      <footer className="scanner-controls">
        <div className="scanner-action-row">
          <div className="scanner-action-spacer" aria-hidden="true" />
          <button
            type="button"
            className={`scanner-capture${status === 'scanning' ? ' busy' : ''}`}
            onClick={() => void captureAndIdentify()}
            disabled={status !== 'ready' && status !== 'scanning'}
            aria-label="Capture card now"
            title="Capture card now"
          >
            <Camera width={26} height={26} strokeWidth={1.8} />
          </button>
          <div className="scanner-secondary-actions">
            <button
              type="button"
              className="btn btn-primary scanner-done"
              onClick={handleConfirm}
              disabled={totalCount === 0}
            >
              {totalCount === 0
                ? 'Add cards'
                : `Add ${totalCount} card${totalCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </footer>

      {sheetOpen && (
        <ScannerQueueSheet
          entries={queue}
          onClose={() => setSheetOpen(false)}
          onChangePrinting={changePrinting}
          onChangeQty={changeQty}
          onRemove={removeFromQueue}
          onClearAll={clearQueue}
        />
      )}
    </div>
  );

  // Portal to document.body so the scanner escapes the app's DOM tree. On
  // native that lets us hide #root while the camera-preview plugin's native
  // preview shows through the (transparent) WebView. On web it's harmless.
  return createPortal(scannerNode, document.body);
}
