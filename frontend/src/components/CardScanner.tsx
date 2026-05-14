import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Flashlight, FlashlightOff, RotateCcw, ScanLine, Trash2, X } from 'lucide-react';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { identifyCard, identifyCardByHash } from '../lib/api';
import { disposeOcr, recognizeText, warmOcr } from '../lib/ocr';
import { dHashFromCanvas, hashToHex } from '../lib/phash';
import type { ScryfallCard } from '@/deck-builder/types';

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
/**
 * Art window inside a standard MTG card frame. These ranges are matched to
 * Scryfall's `image_uris.art_crop` framing, which is what the backend hashed
 * during ingest — keeping client and server crops aligned makes the dHash
 * comparison meaningful. Tuned against modern, modern-foil, old, retro, and
 * showcase frames; full-art / borderless cards still match because dHash on
 * a slightly larger window is dominated by the artwork itself.
 */
const ART_CROP = { x: 0.07, y: 0.12, w: 0.86, h: 0.42 };
/** Auto-scan cadence in ms. Slow enough to let the user reposition cards. */
const AUTO_SCAN_INTERVAL = 1400;

export function CardScanner({ onClose, onConfirm }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** Off-screen canvas reused for every capture — avoids per-frame allocation. */
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const autoTimerRef = useRef<number | null>(null);
  /** Tracks whether a capture is currently in flight, so auto-scan doesn't pile up. */
  const busyRef = useRef(false);
  /** Last successfully identified card id — used to dedupe back-to-back identical scans. */
  const lastIdRef = useRef<string | null>(null);
  /**
   * Cached pHash store size from the server. Becomes definitive after the
   * first /api/cards/identify-hash call; while undefined we still try the
   * pHash path (it's cheap if the store is empty — server returns null fast).
   * If we ever observe storeSize === 0 we stop attempting pHash for the rest
   * of the session and go straight to OCR.
   */
  const phashAvailableRef = useRef<boolean | null>(null);

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
   * True when the camera is delivering a landscape stream into a portrait
   * viewport. Most Android Chrome builds ignore our portrait-resolution
   * request and hand back 1920×1080 regardless; without this rotation the
   * user only sees the middle ~28% of the sensor (the "too zoomed in"
   * complaint). When set we rotate the video element 90° CW visually AND
   * route the capture pipeline through an upright off-screen canvas so
   * OCR/pHash still see an upright card.
   */
  const [needsRotation, setNeedsRotation] = useState(false);

  useLockBodyScroll();

  const showHint = useCallback((msg: string, ms = 1800) => {
    setHint(msg);
    window.setTimeout(() => setHint((current) => (current === msg ? null : current)), ms);
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
      // Decide whether the displayed video needs a 90° rotation. Most
      // Android browsers ignore our portrait resolution hint and deliver
      // a landscape stream; rotating in CSS + crop math lets us treat it
      // as portrait everywhere downstream.
      const streamW = settings.width ?? 0;
      const streamH = settings.height ?? 0;
      const streamIsLandscape = streamW > streamH;
      const viewportIsPortrait =
        typeof window !== 'undefined' && window.innerHeight > window.innerWidth;
      const rotate = streamIsLandscape && viewportIsPortrait;
      setNeedsRotation(rotate);

      const infoLine =
        `${streamW}×${streamH}` +
        ` zoom=${settings.zoom ?? '?'} focus=${settings.focusMode ?? '?'}` +
        (rotate ? ' rot=90' : '');
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
   * Captures a single frame and tries two identification paths in order:
   *
   *   1. **pHash fast path** — crop to the card's art window, compute a 64-bit
   *      dHash, and ask the server for the nearest neighbour in its pre-built
   *      hash DB. Works on any language, robust to soft focus, no Tesseract
   *      cold-start. This is what makes the scanner feel instantaneous.
   *
   *   2. **OCR fallback** — if pHash either returns no confident match or the
   *      server's hash store is empty (DB not yet ingested), crop to the
   *      title strip, OCR it with Tesseract, and resolve via Scryfall's
   *      fuzzy name endpoint. This is what made the scanner work on day 1
   *      and still rescues edge cases (alt-art previews, novel cards added
   *      to Scryfall since the last ingest, etc.).
   */
  const captureAndIdentify = useCallback(async () => {
    if (busyRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    busyRef.current = true;
    setStatus('scanning');
    try {
      const rawW = video.videoWidth;
      const rawH = video.videoHeight;
      // Compute the upright (portrait) card dimensions in *display* terms —
      // i.e. as if we were sampling from a portrait stream. When the raw
      // stream is landscape we route the capture through an upright
      // intermediate canvas (built below) so downstream code can always
      // pretend it's working with a properly-oriented video frame.
      const uprightW = needsRotation ? rawH : rawW;
      const uprightH = needsRotation ? rawW : rawH;

      let cardW: number;
      let cardH: number;
      if (uprightW / uprightH > CARD_ASPECT) {
        cardH = uprightH * 0.84;
        cardW = cardH * CARD_ASPECT;
      } else {
        cardW = uprightW * 0.84;
        cardH = cardW / CARD_ASPECT;
      }
      const cardX = (uprightW - cardW) / 2;
      const cardY = (uprightH - cardH) / 2;

      if (!captureCanvasRef.current) captureCanvasRef.current = document.createElement('canvas');
      const canvas = captureCanvasRef.current;

      /**
       * Draws a sub-rect of the upright card into `canvas` at the requested
       * pixel size, transparently handling stream rotation. When the raw
       * stream is portrait we drawImage straight from the video. When it's
       * landscape we rotate 90° CW while drawing so the destination canvas
       * always ends up with an upright card image, regardless of how the
       * sensor was oriented.
       */
      const drawCardRegion = (
        relX: number,
        relY: number,
        relW: number,
        relH: number,
        dstW: number,
        dstH: number
      ): CanvasRenderingContext2D => {
        canvas.width = dstW;
        canvas.height = dstH;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Could not get canvas context.');
        // Sub-rect in upright (post-rotation) coordinates.
        const upX = cardX + cardW * relX;
        const upY = cardY + cardH * relY;
        const upW = cardW * relW;
        const upH = cardH * relH;
        if (!needsRotation) {
          ctx.drawImage(video, upX, upY, upW, upH, 0, 0, dstW, dstH);
          return ctx;
        }
        // Map the upright sub-rect back into raw video coords. For a 90°
        // CW display rotation:
        //   raw_x = upright_y
        //   raw_y = rawH - upright_x - upright_w
        const srcX = upY;
        const srcY = rawH - upX - upW;
        const srcW = upH;
        const srcH = upW;
        // Draw the (landscape) source rect into the (portrait) destination
        // while rotating 90° CW so the card ends up upright.
        ctx.save();
        ctx.translate(dstW, 0);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, dstH, dstW);
        ctx.restore();
        return ctx;
      };

      // ── Phase 1: pHash fast path ─────────────────────────────────────────
      let resolved: { card: ScryfallCard; via: 'phash' | 'ocr'; raw: string } | null = null;

      if (phashAvailableRef.current !== false) {
        try {
          // Hash from a modest-resolution art crop. The dHash algorithm
          // downsamples to 9x8 internally — there's no benefit to handing
          // it a huge canvas, and a 320px source plays nicely with phone
          // camera noise.
          const artW = Math.round(cardW * ART_CROP.w);
          const artH = Math.round(cardH * ART_CROP.h);
          const targetW = Math.min(320, artW);
          const targetH = Math.round((targetW * artH) / artW);
          drawCardRegion(ART_CROP.x, ART_CROP.y, ART_CROP.w, ART_CROP.h, targetW, targetH);
          const hash = dHashFromCanvas(canvas);
          const hashHex = hashToHex(hash);
          const result = await identifyCardByHash(hashHex);
          phashAvailableRef.current = result.storeSize > 0;
          if (result.card) {
            resolved = { card: result.card, via: 'phash', raw: `phash d=${result.distance}` };
          }
        } catch (err) {
          console.warn('[scanner] phash path failed, falling back to OCR:', err);
        }
      }

      // ── Phase 2: OCR fallback ────────────────────────────────────────────
      if (!resolved) {
        const titleW = cardW * TITLE_CROP.w;
        const titleH = cardH * TITLE_CROP.h;
        // 3x scale because Tesseract is happier with bigger inputs and
        // tight phone-camera crops are often a bit soft.
        const SCALE = 3;
        const dstW = Math.round(titleW * SCALE);
        const dstH = Math.round(titleH * SCALE);
        const ctx = drawCardRegion(
          TITLE_CROP.x,
          TITLE_CROP.y,
          TITLE_CROP.w,
          TITLE_CROP.h,
          dstW,
          dstH
        );

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
          return;
        }
        if (confidence < 35) {
          if (!autoMode) showHint('Low confidence — improve lighting or angle.');
          return;
        }

        const card = await identifyCard(text);
        if (!card) {
          if (!autoMode) showHint(`Couldn't match "${truncate(text, 40)}".`);
          return;
        }
        resolved = { card, via: 'ocr', raw: text };
      }

      // Dedupe: the same card scanned twice in a row almost always means the
      // user is still framing the same physical card. Skip silently in auto
      // mode; in manual mode the user explicitly tapped, so treat each tap
      // as adding another copy.
      if (autoMode && lastIdRef.current === resolved.card.id) return;
      lastIdRef.current = resolved.card.id;

      setQueue((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          card: resolved.card,
          rawText: `${resolved.via}: ${resolved.raw}`,
        },
      ]);
      playBeep();
      if (navigator.vibrate) navigator.vibrate(40);
    } catch (err) {
      console.error('[scanner] capture failed:', err);
      showHint('Scan failed — try again.');
    } finally {
      busyRef.current = false;
      setStatus('ready');
    }
  }, [autoMode, showHint, needsRotation]);

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

  return (
    <div className="scanner-root" role="dialog" aria-label="Card scanner" aria-modal="true">
      <video
        ref={videoRef}
        className={`scanner-video${needsRotation ? ' is-rotated' : ''}`}
        playsInline
        muted
      />

      <div className="scanner-overlay" aria-hidden="true">
        <div className="scanner-viewfinder">
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
