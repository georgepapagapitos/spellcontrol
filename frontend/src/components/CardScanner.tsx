import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Flashlight, FlashlightOff, RotateCcw, ScanLine, Trash2, X } from 'lucide-react';
import { CameraPreview } from '@capacitor-community/camera-preview';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { identifyCard } from '../lib/api';
import { disposeOcr, recognizeText, warmOcr } from '../lib/ocr';
import { isNativePlatform } from '../lib/platform';
import { haptics } from '../lib/haptics';
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

interface ScannedCard {
  /** Local id for queue management. */
  id: string;
  card: ScryfallCard;
  /** Raw OCR text that produced this match — shown on hover for debugging. */
  rawText: string;
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
/** Auto-scan cadence in ms. Slow enough to let the user reposition cards. */
const AUTO_SCAN_INTERVAL = 1400;

export function CardScanner({ onClose, onConfirm }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewfinderRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** Off-screen canvas reused for every capture — avoids per-frame allocation. */
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const autoTimerRef = useRef<number | null>(null);
  /** Tracks whether a capture is currently in flight, so auto-scan doesn't pile up. */
  const busyRef = useRef(false);
  /** Last successfully identified card id — used to dedupe back-to-back identical scans. */
  const lastIdRef = useRef<string | null>(null);

  const [status, setStatus] = useState<ScanStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [queue, setQueue] = useState<ScannedCard[]>([]);
  const [autoMode, setAutoMode] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  /**
   * Resolved camera info shown in a small on-screen badge. Lets us diagnose
   * device-specific behaviour (resolution, zoom, focus mode) without needing
   * the user to open browser DevTools — phone debugging is otherwise a
   * non-starter for most testers.
   */
  const [cameraInfo, setCameraInfo] = useState<string | null>(null);
  /**
   * Diagnostic line for the most recent identification attempt. Shows pHash
   * distance / OCR text so we can see *why* a scan succeeded or failed
   * without having to read the queue thumbnails. Useful while tuning the
   * scan pipeline; we can decide later whether to keep it.
   */
  const [lastAttempt, setLastAttempt] = useState<string | null>(null);
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
        setCameraInfo('native preview');
        setStatus('ready');
        warmOcr();
      } catch (err) {
        console.error('[scanner] native preview failed:', err);
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
          .catch((e) => console.warn('[scanner] could not tune camera:', e));
      }
      // Surface what we actually got — invaluable when diagnosing "looks
      // weird on device X" reports without needing remote debugging.
      const settings = (track?.getSettings?.() ?? {}) as MediaTrackSettings & {
        zoom?: number;
        focusMode?: string;
      };
      const infoLine =
        `${settings.width}×${settings.height}` +
        ` zoom=${settings.zoom ?? '?'} focus=${settings.focusMode ?? '?'}`;
      console.log(`[scanner] camera: ${infoLine}`);
      setCameraInfo(infoLine);
      setStatus('ready');
      warmOcr();
    } catch (err) {
      console.error('[scanner] camera failed:', err);
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
      if (autoTimerRef.current) window.clearInterval(autoTimerRef.current);
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
   * Tesseract, and resolves the recognised text via Scryfall's fuzzy
   * `cards/named` endpoint. An earlier iteration tried a perceptual-hash
   * fast path against a pre-built server DB, but on real phone captures
   * the 64-bit dHash didn't discriminate between cards within the noise
   * floor, so we removed the whole stack and kept the OCR path. See
   * git log for the rip-out commit if you're tempted to bring it back.
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
      // user saw inside the viewfinder box, in both contain (web video
      // element) and cover (native preview captureSample) modes.
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
      if (!text || text.length < 2) {
        if (!autoMode) showHint('No card detected — hold steady and try again.');
        setLastAttempt('ocr empty');
        return;
      }
      if (confidence < 35) {
        if (!autoMode) showHint('Low confidence — improve lighting or angle.');
        setLastAttempt(`ocr low confidence (${Math.round(confidence)})`);
        return;
      }

      const card = await identifyCard(text);
      if (!card) {
        if (!autoMode) showHint(`Couldn't match "${truncate(text, 40)}".`);
        setLastAttempt(`ocr no match: "${truncate(text, 24)}"`);
        return;
      }
      setLastAttempt(`ocr "${truncate(text, 16)}" → ${truncate(card.name, 24)}`);

      // Dedupe: the same card scanned twice in a row almost always means the
      // user is still framing the same physical card. Skip silently in auto
      // mode; in manual mode the user explicitly tapped, so treat each tap
      // as adding another copy.
      if (autoMode && lastIdRef.current === card.id) return;
      lastIdRef.current = card.id;

      setQueue((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          card,
          rawText: text,
        },
      ]);
      playBeep();
      haptics.success();
    } catch (err) {
      console.error('[scanner] capture failed:', err);
      showHint('Scan failed — try again.');
    } finally {
      busyRef.current = false;
      setStatus('ready');
    }
  }, [autoMode, showHint, viewfinderRect]);

  // Auto-scan loop. When the user enables auto mode, fire captureAndIdentify
  // on a steady interval. The `busyRef` guard inside the function prevents
  // overlapping calls if a previous capture is still resolving.
  useEffect(() => {
    if (!autoMode || status === 'error') return;
    const id = window.setInterval(() => {
      void captureAndIdentify();
    }, AUTO_SCAN_INTERVAL);
    autoTimerRef.current = id;
    return () => window.clearInterval(id);
  }, [autoMode, status, captureAndIdentify]);

  const removeFromQueue = (id: string) => {
    setQueue((prev) => prev.filter((s) => s.id !== id));
    // Allow re-scanning the same card after a manual removal.
    lastIdRef.current = null;
  };

  const clearQueue = () => {
    setQueue([]);
    lastIdRef.current = null;
  };

  const handleConfirm = () => {
    if (queue.length === 0) return;
    // Aggregate quantities so duplicates produced by auto-mode in different
    // sessions still collapse cleanly when handed to the importer.
    const counts = new Map<string, { card: ScryfallCard; qty: number }>();
    for (const s of queue) {
      const key = `${s.card.name}::${s.card.set}::${s.card.collector_number}`;
      const existing = counts.get(key);
      if (existing) existing.qty += 1;
      else counts.set(key, { card: s.card, qty: 1 });
    }
    const lines: string[] = [];
    for (const { card, qty } of counts.values()) {
      lines.push(`${qty} ${card.name} (${card.set.toUpperCase()}) ${card.collector_number}`);
    }
    onConfirm(lines.join('\n'), queue.length);
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
          {(status === 'scanning' || autoMode) && <div className="scanner-scanline" />}
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
        <div className="scanner-status">
          <ScanLine width={14} height={14} strokeWidth={1.8} />
          <span>
            {queue.length === 0
              ? 'Frame a card inside the box'
              : `${queue.length} scanned · keep going`}
          </span>
        </div>
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

      {cameraInfo && <div className="scanner-debug">cam: {cameraInfo}</div>}
      {lastAttempt && <div className="scanner-debug scanner-debug-second">last: {lastAttempt}</div>}

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
        {queue.length > 0 && (
          <div className="scanner-queue" aria-label="Scanned cards">
            {queue.map((s) => {
              const img = s.card.image_uris?.small || s.card.card_faces?.[0]?.image_uris?.small;
              return (
                <div key={s.id} className="scanner-queue-item" title={s.rawText}>
                  {img ? (
                    <img src={img} alt={s.card.name} loading="lazy" />
                  ) : (
                    <div className="scanner-queue-fallback">{s.card.name}</div>
                  )}
                  <button
                    type="button"
                    className="scanner-queue-remove"
                    onClick={() => removeFromQueue(s.id)}
                    aria-label={`Remove ${s.card.name}`}
                  >
                    <X width={12} height={12} strokeWidth={2.2} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="scanner-action-row">
          <label className="scanner-auto-toggle">
            <input
              type="checkbox"
              checked={autoMode}
              onChange={(e) => setAutoMode(e.target.checked)}
              disabled={status === 'error'}
            />
            <span>Auto-scan</span>
          </label>

          <button
            type="button"
            className={`scanner-capture${status === 'scanning' ? ' busy' : ''}`}
            onClick={() => void captureAndIdentify()}
            disabled={status !== 'ready' && status !== 'scanning'}
            aria-label="Capture card"
          >
            <Camera width={26} height={26} strokeWidth={1.8} />
          </button>

          <div className="scanner-secondary-actions">
            {queue.length > 0 && (
              <button
                type="button"
                className="scanner-icon-btn"
                onClick={clearQueue}
                aria-label="Clear queue"
                title="Clear queue"
              >
                <Trash2 width={16} height={16} strokeWidth={1.8} />
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary scanner-done"
              onClick={handleConfirm}
              disabled={queue.length === 0}
            >
              {queue.length === 0
                ? 'Add cards'
                : `Add ${queue.length} card${queue.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );

  // Portal to document.body so the scanner escapes the app's DOM tree. On
  // native that lets us hide #root while the camera-preview plugin's native
  // preview shows through the (transparent) WebView. On web it's harmless.
  return createPortal(scannerNode, document.body);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Plays a brief synthesized "ding" via WebAudio. Cheaper than shipping an
 * audio file and works without user-gesture restrictions because the click
 * that triggered capture is already a gesture.
 */
let audioCtx: AudioContext | null = null;
function playBeep() {
  try {
    if (!audioCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new Ctor();
    }
    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch {
    // Audio is best-effort; silently swallow if blocked.
  }
}
