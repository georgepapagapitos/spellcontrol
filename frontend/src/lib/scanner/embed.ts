/* eslint-disable no-console -- Spike diagnostics need to fire in
   production-mode Capacitor builds; see note in embed-loader.ts. */
// Run a single MobileCLIP2-S0 vision-encoder inference on a canvas.
//
// MobileCLIP2-S0's `preprocessor_config.json` specifies:
//   - resize shortest_edge=256, center_crop 256×256
//   - image_mean=[0,0,0], image_std=[1,1,1]  →  pixel/255, no further norm
//   - input tensor name "pixel_values", layout NCHW [1,3,256,256], float32
//   - output tensor name "image_embeds", shape [1,512], unnormalized → L2
//
// Caller passes the art crop (or any canvas). We resize to 256×256 with a
// scratch canvas — for the spike we stretch rather than letterbox; the
// art crop is roughly square and the backend ingest will use the same
// preprocessing so the embeddings will be self-consistent.

import { loadEmbedder } from './embed-loader';

export const EMBED_INPUT_SIZE = 256;
export const EMBED_DIM = 512;

export interface EmbedResult {
  embedding: Float32Array;
  preprocessMs: number;
  inferMs: number;
  totalMs: number;
}

export async function embedCanvas(source: HTMLCanvasElement): Promise<EmbedResult> {
  const t0 = performance.now();
  const { ort, session } = await loadEmbedder();

  // 256×256 RGB scratch canvas, no aspect preservation.
  const scratch = document.createElement('canvas');
  scratch.width = EMBED_INPUT_SIZE;
  scratch.height = EMBED_INPUT_SIZE;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas context unavailable for embed resize');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, EMBED_INPUT_SIZE, EMBED_INPUT_SIZE);

  const { data: rgba } = ctx.getImageData(0, 0, EMBED_INPUT_SIZE, EMBED_INPUT_SIZE);

  // Planar NCHW float32 in [0,1]. RGB order (drop alpha). The standard
  // CLIPImageProcessor preprocessing with mean=0, std=1 is just pixel/255.
  const planeSize = EMBED_INPUT_SIZE * EMBED_INPUT_SIZE;
  const tensorData = new Float32Array(3 * planeSize);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    tensorData[p] = rgba[i] / 255; // R
    tensorData[planeSize + p] = rgba[i + 1] / 255; // G
    tensorData[2 * planeSize + p] = rgba[i + 2] / 255; // B
  }
  const preprocessMs = performance.now() - t0;

  const tensor = new ort.Tensor('float32', tensorData, [1, 3, EMBED_INPUT_SIZE, EMBED_INPUT_SIZE]);
  const inferT0 = performance.now();
  const outputs = await session.run({ pixel_values: tensor });
  const inferMs = performance.now() - inferT0;

  const out = outputs.image_embeds ?? outputs[session.outputNames[0]];
  if (!out) throw new Error('embedder: missing image_embeds output');
  const raw = out.data as Float32Array;
  if (raw.length !== EMBED_DIM) {
    throw new Error(`embedder: expected ${EMBED_DIM} dims, got ${raw.length}`);
  }

  // L2-normalize so cosine sim reduces to a dot product downstream.
  let sumSq = 0;
  for (let i = 0; i < raw.length; i++) sumSq += raw[i] * raw[i];
  const inv = sumSq > 0 ? 1 / Math.sqrt(sumSq) : 0;
  const embedding = new Float32Array(EMBED_DIM);
  for (let i = 0; i < raw.length; i++) embedding[i] = raw[i] * inv;

  const totalMs = performance.now() - t0;
  console.log(
    `[scanner] embed: preprocess=${preprocessMs.toFixed(1)}ms infer=${inferMs.toFixed(1)}ms total=${totalMs.toFixed(1)}ms norm2(out)=${Math.sqrt(sumSq).toFixed(3)}`
  );
  return { embedding, preprocessMs, inferMs, totalMs };
}
