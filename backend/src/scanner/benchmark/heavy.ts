// The two benchmark stages that need the MobileCLIP model and the embedding
// index: the embedding-only search and the production matcher. Kept apart from
// run.ts because the embedding index is a Git LFS file (absent in the default
// CI checkout) and the model load takes seconds, so only the opt-in benchmark
// and the manual workflow reach for it.

import * as path from 'node:path';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import { EMBED_INPUT_SIZE, embedTensor } from '../embedding-ingest';
import { loadEmbeddingDbFromFile, rerankByCosine } from '../embedding-db';
import { createMatcher, type Matcher } from '../matcher';
import type { Stage } from './run';

export const DEFAULT_DATA_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'scanner');

/** True when the embedding index is the real binary, not a Git LFS pointer. */
export async function embeddingIndexIsReal(dataDir: string): Promise<boolean> {
  const { statSync } = await import('node:fs');
  try {
    return statSync(path.join(dataDir, 'card-embeddings.bin')).size > 1_000_000;
  } catch {
    return false;
  }
}

async function tensorOfImage(image: Buffer): Promise<Float32Array> {
  const raw = await sharp(image)
    .resize(EMBED_INPUT_SIZE, EMBED_INPUT_SIZE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();
  const plane = EMBED_INPUT_SIZE * EMBED_INPUT_SIZE;
  const out = new Float32Array(3 * plane);
  for (let i = 0, p = 0; i < raw.length; i += 3, p++) {
    out[p] = raw[i] / 255;
    out[plane + p] = raw[i + 1] / 255;
    out[2 * plane + p] = raw[i + 2] / 255;
  }
  return out;
}

export interface HeavyStages {
  embedding: Stage;
  pipeline: Stage;
  matcher: Matcher;
  close(): Promise<void>;
}

export async function createHeavyStages(dataDir: string = DEFAULT_DATA_DIR): Promise<HeavyStages> {
  const [db, session, matcher] = await Promise.all([
    loadEmbeddingDbFromFile(path.join(dataDir, 'card-embeddings.bin')),
    ort.InferenceSession.create(path.join(dataDir, 'embed', 'vision_model.onnx'), {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    }),
    createMatcher({ dataDir }),
  ]);
  const everyRow = Array.from({ length: db.recordCount }, (_, i) => i);
  return {
    matcher,
    embedding: {
      name: 'embedding',
      async predict(image) {
        const q = await embedTensor(session, await tensorOfImage(image));
        return { ranked: rerankByCosine(db, everyRow, q, 3).map((m) => m.scryfallId) };
      },
    },
    pipeline: {
      name: 'pipeline',
      async predict(image) {
        const r = await matcher.match(image);
        if (r.kind === 'confident') return { kind: 'confident', ranked: [r.match.scryfallId] };
        if (r.kind === 'borderline') {
          return { kind: 'borderline', ranked: r.candidates.map((c) => c.scryfallId) };
        }
        return { kind: 'miss', ranked: [] };
      },
    },
    async close() {
      await matcher.close();
      await session.release();
    },
  };
}
