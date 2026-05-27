/* eslint-disable no-console -- Spike diagnostics need to fire in the
   production-mode Capacitor build (logger.info is dev-only), so we use
   console.* directly. Remove this disable when the spike either ships
   or is replaced. */
// Scanner v2 spike harness. Reachable at /scanner-v2-spike — outside the
// auth gate and the Layout shell. Pick a phone photo of a card, watch
// OpenCV.js lazy-load (timing logged), see the quad overlay on the input,
// the perspective-warped 488×680 output, and the top pHash matches against
// the shipped card-hashes.bin. See docs/scanner-v2-handoff.md.

import { useEffect, useRef, useState } from 'react';
import { loadOpenCv } from '@/lib/scanner-v2/opencv-loader';
import {
  detectAndWarpCard,
  WARP_WIDTH,
  WARP_HEIGHT,
  type DetectResult,
  type Point,
} from '@/lib/scanner-v2/detect';
import { hashCanvas, cropArtRegion } from '@/lib/scanner-v2/phash';
import { applyCLAHE } from '@/lib/scanner-v2/normalize';
import { loadHashDb, findNearest, type HashDb, type Match } from '@/lib/scanner-v2/hash-db';
import { loadEmbedder } from '@/lib/scanner-v2/embed-loader';
import { embedCanvas, makeTestCanvas, EMBED_DIM } from '@/lib/scanner-v2/embed';
import {
  loadEmbeddingDb,
  rerankByCosineUuids,
  type EmbeddingDb,
  type EmbedMatch,
} from '@/lib/scanner-v2/embedding-db';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; loadMs: number }
  | { status: 'error'; message: string };

type DbState =
  | { status: 'loading' }
  | { status: 'ready'; loadMs: number; recordCount: number; bytes: number }
  | { status: 'missing' }
  | { status: 'error'; message: string };

type EmbedState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; scriptLoadMs: number; sessionLoadMs: number; totalLoadMs: number }
  | { status: 'error'; message: string };

interface MatchSummary {
  hash: bigint;
  hashMs: number;
  matchMs: number;
  matches: Match[];
}

interface EmbedSummary {
  label: string;
  preprocessMs: number;
  inferMs: number;
  totalMs: number;
  norm2: number;
  preview: string;
}

interface RerankSummary {
  candidateCount: number;
  rerankMs: number;
  matches: EmbedMatch[];
}

// Global CSS sets `body { overflow: hidden }` so the in-app shell can own
// its own scroll container. The spike route mounts outside that shell, so
// we own it ourselves: fill the dynamic viewport, scroll vertically.
const FRAME_STYLE: React.CSSProperties = {
  background: '#0a1f3d',
  color: '#e8eef9',
  height: '100dvh',
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
  padding: 16,
  paddingBottom: 64,
  boxSizing: 'border-box',
  fontFamily: 'system-ui, sans-serif',
};

const PANEL_STYLE: React.CSSProperties = {
  background: '#102a52',
  border: '1px solid #1f3f78',
  borderRadius: 8,
  padding: 12,
  marginBottom: 12,
};

const BUTTON_STYLE: React.CSSProperties = {
  background: '#1f3f78',
  color: '#e8eef9',
  border: '1px solid #2a558f',
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 14,
  cursor: 'pointer',
  minHeight: 44,
};

export function ScannerV2SpikePage() {
  // Both initial loads kick off in the mount effect; initialize state here
  // so we don't trigger the react-hooks set-state-in-effect lint and an
  // extra render cycle.
  const [opencv, setOpencv] = useState<LoadState>({ status: 'loading' });
  const [db, setDb] = useState<DbState>({ status: 'loading' });
  const [dbRef, setDbRef] = useState<HashDb | null>(null);
  const [embed, setEmbed] = useState<EmbedState>({ status: 'idle' });
  const [embedResult, setEmbedResult] = useState<EmbedSummary | null>(null);
  const [embedDb, setEmbedDb] = useState<DbState>({ status: 'loading' });
  const [embedDbRef, setEmbedDbRef] = useState<EmbeddingDb | null>(null);
  const [rerank, setRerank] = useState<RerankSummary | null>(null);
  const [result, setResult] = useState<DetectResult | null>(null);
  const [match, setMatch] = useState<MatchSummary | null>(null);
  const [detectErr, setDetectErr] = useState<string | null>(null);
  const [imageURL, setImageURL] = useState<string | null>(null);
  const inputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const warpedHolderRef = useRef<HTMLDivElement | null>(null);
  const artHolderRef = useRef<HTMLDivElement | null>(null);
  const normalizedHolderRef = useRef<HTMLDivElement | null>(null);

  // Kick off opencv + hash-db loads in parallel. They're independent — the
  // user can stare at the loading panels while both run.
  useEffect(() => {
    let cancelled = false;
    loadOpenCv()
      .then(({ loadMs }) => {
        if (!cancelled) setOpencv({ status: 'ready', loadMs });
      })
      .catch((err) => {
        if (!cancelled)
          setOpencv({
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
      });

    const dbStart = performance.now();
    loadHashDb()
      .then((loaded) => {
        if (cancelled) return;
        setDbRef(loaded);
        setDb({
          status: 'ready',
          loadMs: performance.now() - dbStart,
          recordCount: loaded.recordCount,
          bytes: loaded.bytes,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        // The bin file is generated by a backend ingest script; a fresh
        // worktree won't have it. Surface that as a friendly "missing"
        // state so the spike still runs detection-only.
        if (/HTTP 404/.test(msg)) setDb({ status: 'missing' });
        else setDb({ status: 'error', message: msg });
      });

    const embedDbStart = performance.now();
    loadEmbeddingDb()
      .then((loaded) => {
        if (cancelled) return;
        setEmbedDbRef(loaded);
        setEmbedDb({
          status: 'ready',
          loadMs: performance.now() - embedDbStart,
          recordCount: loaded.recordCount,
          bytes: loaded.bytes,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (/HTTP 404/.test(msg)) setEmbedDb({ status: 'missing' });
        else setEmbedDb({ status: 'error', message: msg });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (imageURL) URL.revokeObjectURL(imageURL);
    };
  }, [imageURL]);

  // Embedder load is *manual* — we want a clean cold-load timing for the
  // Phase 2 model-selection report, so it doesn't kick off alongside the
  // opencv + hash-db parallel boot. Click → log → measure.
  async function handleLoadEmbedder() {
    setEmbed({ status: 'loading' });
    setEmbedResult(null);
    try {
      const { scriptLoadMs, sessionLoadMs, totalLoadMs } = await loadEmbedder();
      setEmbed({ status: 'ready', scriptLoadMs, sessionLoadMs, totalLoadMs });
    } catch (err) {
      setEmbed({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleDummyInfer() {
    if (embed.status !== 'ready') {
      await handleLoadEmbedder();
    }
    try {
      const canvas = makeTestCanvas();
      const { embedding, preprocessMs, inferMs, totalMs } = await embedCanvas(canvas);
      const norm2 = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
      const head = Array.from(embedding.slice(0, 4))
        .map((v) => v.toFixed(3))
        .join(', ');
      setEmbedResult({
        label: 'dummy 256×256 gradient',
        preprocessMs,
        inferMs,
        totalMs,
        norm2,
        preview: `[${head}, …] (${EMBED_DIM} dims)`,
      });
    } catch (err) {
      setEmbed({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleFile(file: File) {
    setDetectErr(null);
    setResult(null);
    setMatch(null);
    setEmbedResult(null);
    setRerank(null);

    if (opencv.status !== 'ready') {
      setDetectErr('OpenCV not ready yet — wait for load to finish.');
      return;
    }

    const url = URL.createObjectURL(file);
    setImageURL(url);

    const img = await loadImage(url);

    const canvas = inputCanvasRef.current;
    if (!canvas) return;
    const maxOnScreen = Math.min(window.innerWidth - 32, 900);
    const scale = img.naturalWidth > maxOnScreen ? maxOnScreen / img.naturalWidth : 1;
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    try {
      const { cv } = await loadOpenCv();
      const r = await detectAndWarpCard(cv, img);
      setResult(r);

      if (r.quad) drawQuadOverlay(ctx, r.quad, scale);

      const holder = warpedHolderRef.current;
      if (r.warped && holder) {
        holder.replaceChildren();
        r.warped.style.width = '244px';
        r.warped.style.height = '340px';
        r.warped.style.border = '1px solid #1f3f78';
        r.warped.style.borderRadius = '8px';
        holder.appendChild(r.warped);

        // Apply CLAHE to even out lighting variance before hashing. We
        // display both the raw warp and the normalized version so the
        // effect is visible side-by-side. Backend reference hashes come
        // from professionally-lit Scryfall images, so normalizing the
        // phone-photo input is what pulls the query closer to the
        // canonical representation.
        const tNorm0 = performance.now();
        const normalized = applyCLAHE(r.warped);
        const tNorm = performance.now() - tNorm0;

        // The CLAHE canvas can only live in one parent at a time — cloning
        // a canvas does NOT copy its rendered pixels, so we have to display
        // the original. The hash code below reads pixels via getImageData,
        // which works regardless of where the canvas is mounted.
        const normHolder = normalizedHolderRef.current;
        if (normHolder) {
          normHolder.replaceChildren();
          normalized.style.width = '244px';
          normalized.style.height = '340px';
          normalized.style.border = '1px solid #1f3f78';
          normalized.style.borderRadius = '8px';
          normHolder.appendChild(normalized);
        }

        // Show the art crop from the *color* warp for visual debugging —
        // easier to eyeball the region against the actual card art. The
        // hash uses the CLAHE'd grayscale version below.
        const artHolder = artHolderRef.current;
        if (artHolder) {
          const art = cropArtRegion(r.warped);
          artHolder.replaceChildren();
          art.style.width = '244px';
          art.style.height = `${(244 * art.height) / art.width}px`;
          art.style.border = '1px solid #1f3f78';
          art.style.borderRadius = '8px';
          artHolder.appendChild(art);
        }

        // Hash the normalized card and look it up. Both steps are timed so
        // we can see whether match latency is acceptable on-device.
        if (dbRef) {
          const t0 = performance.now();
          const hash = hashCanvas(normalized);
          const tHash = performance.now() - t0;
          const t1 = performance.now();
          // Wider candidate pool than the display top-5: the cosine
          // re-rank below sorts these 50, then we render the top 5 of
          // *that* alongside the raw pHash top 5.
          const candidates = findNearest(dbRef, hash, 50);
          const tMatch = performance.now() - t1;
          setMatch({ hash, hashMs: tHash, matchMs: tMatch, matches: candidates.slice(0, 5) });
          // Log so adb logcat captures the values — typing them off the
          // device screen is painful when iterating.
          console.log(
            `[scanner-v2] hash=0x${hash.toString(16).padStart(16, '0')} normMs=${tNorm.toFixed(1)} hashMs=${tHash.toFixed(1)} scanMs=${tMatch.toFixed(1)} matches=${candidates
              .slice(0, 5)
              .map((m) => `${m.distance}@${m.scryfallId.slice(0, 8)}`)
              .join(',')}`
          );

          // Two-stage match: if both the embedder and the embedding DB
          // are loaded, embed the art crop and rerank the pHash candidates
          // by cosine similarity. This is the production path; the pHash
          // top-5 panel above is kept for side-by-side comparison.
          if (embed.status === 'ready' && embedDbRef) {
            try {
              const art = cropArtRegion(r.warped);
              const e = await embedCanvas(art);
              const candidateUuids = candidates.map((c) => c.scryfallId);
              const rerankT0 = performance.now();
              const reranked = rerankByCosineUuids(embedDbRef, candidateUuids, e.embedding, 5);
              const rerankMs = performance.now() - rerankT0;
              setRerank({
                candidateCount: candidates.length,
                rerankMs,
                matches: reranked,
              });
              const norm2 = Math.sqrt(e.embedding.reduce((s, v) => s + v * v, 0));
              const head = Array.from(e.embedding.slice(0, 4))
                .map((v) => v.toFixed(3))
                .join(', ');
              setEmbedResult({
                label: 'art crop',
                preprocessMs: e.preprocessMs,
                inferMs: e.inferMs,
                totalMs: e.totalMs,
                norm2,
                preview: `[${head}, …] (${EMBED_DIM} dims)`,
              });
              console.log(
                `[scanner-v2] rerank: ${candidates.length}→${reranked.length} in ${rerankMs.toFixed(1)}ms top=${reranked
                  .map((m) => `${m.similarity.toFixed(0)}@${m.scryfallId.slice(0, 8)}`)
                  .join(',')}`
              );
            } catch (err) {
              console.error('[scanner-v2] rerank failed', err);
            }
          }
        }
      }
    } catch (err) {
      setDetectErr(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div style={FRAME_STYLE}>
      <h1 style={{ fontSize: 20, marginTop: 0 }}>Scanner v2 — spike</h1>
      <p style={{ opacity: 0.75, marginTop: 0 }}>
        Pick a phone photo of a Magic card to run OpenCV.js quad detection + perspective warp +
        pHash lookup against the shipped card-hashes DB.
      </p>

      <div style={PANEL_STYLE}>
        <strong>OpenCV.js runtime:</strong> {opencv.status === 'loading' && 'loading…'}
        {opencv.status === 'ready' && (
          <span>
            ready — cold-load <code>{opencv.loadMs.toFixed(0)}ms</code> (target &lt;2000ms on
            mid-range Android)
          </span>
        )}
        {opencv.status === 'error' && (
          <span style={{ color: '#ff9c9c' }}>error: {opencv.message}</span>
        )}
      </div>

      <div style={PANEL_STYLE}>
        <strong>Hash DB:</strong> {db.status === 'loading' && 'loading…'}
        {db.status === 'ready' && (
          <span>
            <code>{db.recordCount.toLocaleString()}</code> records ({(db.bytes / 1024).toFixed(0)}{' '}
            KB) in <code>{db.loadMs.toFixed(0)}ms</code>
          </span>
        )}
        {db.status === 'missing' && (
          <span style={{ color: '#ffd27a' }}>
            not present — run{' '}
            <code>tsx --env-file .env src/scripts/ingest-card-hashes.ts --limit 100</code> from
            backend/ to generate it. Detection-only mode for now.
          </span>
        )}
        {db.status === 'error' && <span style={{ color: '#ff9c9c' }}>error: {db.message}</span>}
      </div>

      <div style={PANEL_STYLE}>
        <strong>Embedding DB:</strong> {embedDb.status === 'loading' && 'loading…'}
        {embedDb.status === 'ready' && (
          <span>
            <code>{embedDb.recordCount.toLocaleString()}</code> records (
            {(embedDb.bytes / 1024 / 1024).toFixed(2)} MB) in{' '}
            <code>{embedDb.loadMs.toFixed(0)}ms</code>
          </span>
        )}
        {embedDb.status === 'missing' && (
          <span style={{ color: '#ffd27a' }}>
            not present — run{' '}
            <code>npx tsx src/scripts/ingest-card-embeddings.ts --limit 2000</code> from backend/.
            Two-stage match disabled until present.
          </span>
        )}
        {embedDb.status === 'error' && (
          <span style={{ color: '#ff9c9c' }}>error: {embedDb.message}</span>
        )}
      </div>

      <div style={PANEL_STYLE}>
        <strong>Embedder (MobileCLIP2-S0):</strong>{' '}
        {embed.status === 'idle' && (
          <span style={{ opacity: 0.75 }}>not loaded — Phase 2 spike, click to measure</span>
        )}
        {embed.status === 'loading' && 'loading…'}
        {embed.status === 'ready' && (
          <span>
            ready — script <code>{embed.scriptLoadMs.toFixed(0)}ms</code>, session{' '}
            <code>{embed.sessionLoadMs.toFixed(0)}ms</code>, total{' '}
            <code>{embed.totalLoadMs.toFixed(0)}ms</code>
          </span>
        )}
        {embed.status === 'error' && (
          <span style={{ color: '#ff9c9c' }}>error: {embed.message}</span>
        )}
        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => void handleLoadEmbedder()}
            disabled={embed.status === 'loading'}
            style={BUTTON_STYLE}
          >
            Load embedder
          </button>
          <button
            type="button"
            onClick={() => void handleDummyInfer()}
            disabled={embed.status === 'loading'}
            style={BUTTON_STYLE}
          >
            Run dummy inference (256×256)
          </button>
        </div>
        {embedResult && (
          <div style={{ marginTop: 8, fontSize: 13 }}>
            <strong>Inference ({embedResult.label}):</strong> preprocess{' '}
            <code>{embedResult.preprocessMs.toFixed(1)}ms</code>, inference{' '}
            <code>{embedResult.inferMs.toFixed(1)}ms</code>, total{' '}
            <code>{embedResult.totalMs.toFixed(1)}ms</code>, raw-norm{' '}
            <code>{embedResult.norm2.toFixed(3)}</code>
            <div style={{ opacity: 0.75, marginTop: 4 }}>{embedResult.preview}</div>
          </div>
        )}
      </div>

      <div style={PANEL_STYLE}>
        <label htmlFor="scanner-v2-file" style={{ display: 'block', marginBottom: 8 }}>
          <strong>Pick a card photo</strong>
        </label>
        <input
          id="scanner-v2-file"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </div>

      {detectErr && (
        <div style={{ ...PANEL_STYLE, borderColor: '#ff5757', color: '#ff9c9c' }}>{detectErr}</div>
      )}

      {result && (
        <div style={PANEL_STYLE}>
          <strong>Detection:</strong> <code>{result.detectMs.toFixed(0)}ms</code> on{' '}
          {result.scaledSize.width}×{result.scaledSize.height} (target &lt;500ms)
          {result.reason && <span style={{ color: '#ffd27a' }}> — {result.reason}</span>}
        </div>
      )}

      {match && (
        <div style={PANEL_STYLE}>
          <strong>Match:</strong> hash <code>0x{match.hash.toString(16).padStart(16, '0')}</code> in{' '}
          <code>{match.hashMs.toFixed(0)}ms</code>, scan <code>{match.matchMs.toFixed(0)}ms</code>
          <table
            style={{
              width: '100%',
              marginTop: 8,
              fontSize: 13,
              borderCollapse: 'collapse',
            }}
          >
            <thead>
              <tr style={{ opacity: 0.75, textAlign: 'left' }}>
                <th style={{ paddingRight: 12 }}>Hamming</th>
                <th>Scryfall ID</th>
              </tr>
            </thead>
            <tbody>
              {match.matches.map((m) => (
                <tr key={m.scryfallId}>
                  <td style={{ paddingRight: 12 }}>
                    <code>{m.distance}</code>
                  </td>
                  <td>
                    <a
                      href={`https://scryfall.com/card/${m.scryfallId}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#7fd6ff' }}
                    >
                      {m.scryfallId}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>
            Hamming ≤ 10 typically means same printing; 11–20 is same card, different printing; &gt;
            20 is likely a miss.
          </div>
        </div>
      )}

      {rerank && (
        <div style={PANEL_STYLE}>
          <strong>Cosine re-rank:</strong> {rerank.candidateCount} candidates →{' '}
          {rerank.matches.length} top in <code>{rerank.rerankMs.toFixed(2)}ms</code>
          <table
            style={{
              width: '100%',
              marginTop: 8,
              fontSize: 13,
              borderCollapse: 'collapse',
            }}
          >
            <thead>
              <tr style={{ opacity: 0.75, textAlign: 'left' }}>
                <th style={{ paddingRight: 12 }}>Score</th>
                <th>Scryfall ID</th>
              </tr>
            </thead>
            <tbody>
              {rerank.matches.map((m) => (
                <tr key={m.scryfallId}>
                  <td style={{ paddingRight: 12 }}>
                    <code>{m.similarity.toFixed(1)}</code>
                  </td>
                  <td>
                    <a
                      href={`https://scryfall.com/card/${m.scryfallId}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#7fd6ff' }}
                    >
                      {m.scryfallId}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>
            Score is the raw int8×fp32 dot product (proportional to cosine sim). Divide by
            512^(½)×127 to recover the absolute similarity; ordering is what matters for the picker.
          </div>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          alignItems: 'flex-start',
        }}
      >
        <div>
          <div style={{ opacity: 0.75, marginBottom: 4 }}>Input + quad overlay</div>
          <canvas
            ref={inputCanvasRef}
            style={{
              maxWidth: '100%',
              border: '1px solid #1f3f78',
              borderRadius: 8,
              background: '#021129',
            }}
          />
        </div>
        <div>
          <div style={{ opacity: 0.75, marginBottom: 4 }}>
            Warped {WARP_WIDTH}×{WARP_HEIGHT}
          </div>
          <div ref={warpedHolderRef} />
        </div>
        <div>
          <div style={{ opacity: 0.75, marginBottom: 4 }}>CLAHE-normalized</div>
          <div ref={normalizedHolderRef} />
        </div>
        <div>
          <div style={{ opacity: 0.75, marginBottom: 4 }}>Art crop (hashed)</div>
          <div ref={artHolderRef} />
        </div>
      </div>
    </div>
  );
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = url;
  });
}

function drawQuadOverlay(ctx: CanvasRenderingContext2D, quad: Point[], scale: number): void {
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#33ff99';
  ctx.beginPath();
  quad.forEach((p, i) => {
    const x = p.x * scale;
    const y = p.y * scale;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = '#33ff99';
  quad.forEach((p, i) => {
    const x = p.x * scale;
    const y = p.y * scale;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#021129';
    ctx.font = 'bold 12px system-ui';
    ctx.fillText(['TL', 'TR', 'BR', 'BL'][i] ?? String(i), x + 8, y - 8);
    ctx.fillStyle = '#33ff99';
  });
  ctx.restore();
}
