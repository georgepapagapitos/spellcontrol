// Synthetic camera degradations for the scanner benchmark.
//
// A real phone shot reaches the matcher as the art window of a perspective-
// corrected card crop. These functions imitate what goes wrong on the way, so
// a clean Scryfall art image can stand in for a camera frame. They are an
// approximation, not a camera: the benchmark page says so, and the real-phone
// numbers are a separate, later measurement.
//
// Every function is pure given its inputs and the seeded `rnd`, so the same
// card and condition always yield the same query.

import sharp from 'sharp';
import { gaussian, mulberry32, seedFromString } from './rng';

export interface RawImage {
  /** Interleaved RGB, 3 bytes per pixel. */
  data: Uint8Array;
  width: number;
  height: number;
}

export interface Condition {
  id: string;
  label: string;
  /** One sentence for the method page: what is done to the image. */
  doc: string;
  /** Corner displacement as a fraction of width/height (residual after the warp). */
  perspective?: number;
  /** Gaussian blur sigma in source pixels (defocus / motion). */
  blurSigma?: number;
  /** Specular highlight: peak whiteness 0..1 and radius as a fraction of width. */
  glare?: { strength: number; radius: number };
  /** Fraction of the image area hidden by an opaque strip along one edge. */
  occlusion?: number;
  /** Per-channel Gaussian sensor noise, standard deviation in 0..255 units. */
  noiseSigma?: number;
  /** JPEG quality of the final encode. Omitted: the source bytes are used as is. */
  jpegQuality?: number;
}

/** The client re-encodes the warped crop at quality 0.9 before upload. */
export const UPLOAD_JPEG_QUALITY = 90;

export const CONDITIONS: readonly Condition[] = [
  {
    id: 'clean',
    label: 'Clean',
    doc: 'The Scryfall art_crop image, unchanged. The control: the index was built from these exact images.',
  },
  {
    id: 'perspective',
    label: 'Perspective',
    doc: 'A projective warp with each corner moved up to 6% of the image size, then a JPEG re-encode at quality 90. This imitates the error left after the card is straightened.',
    perspective: 0.06,
    jpegQuality: UPLOAD_JPEG_QUALITY,
  },
  {
    id: 'blur',
    label: 'Blur',
    doc: 'Gaussian blur with sigma 4 px on a roughly 626 px wide image (out of focus or moving), then a JPEG re-encode at quality 90.',
    blurSigma: 4,
    jpegQuality: UPLOAD_JPEG_QUALITY,
  },
  {
    id: 'glare',
    label: 'Glare',
    doc: 'A soft white highlight (peak 85% whiteness, radius 35% of the width) at a random spot, like a light reflecting off a sleeve or foil. JPEG quality 90.',
    glare: { strength: 0.85, radius: 0.35 },
    jpegQuality: UPLOAD_JPEG_QUALITY,
  },
  {
    id: 'noise',
    label: 'Noise and compression',
    doc: 'Gaussian sensor noise (standard deviation 14 of 255 per channel) and a hard JPEG re-encode at quality 35, like a dim room and a compressed upload.',
    noiseSigma: 14,
    jpegQuality: 35,
  },
  {
    id: 'occlusion',
    label: 'Occlusion',
    doc: 'An opaque dark strip hiding 20% of the image along a random edge, like a thumb or a binder ring. JPEG quality 90.',
    occlusion: 0.2,
    jpegQuality: UPLOAD_JPEG_QUALITY,
  },
  {
    id: 'combined',
    label: 'Combined',
    doc: 'Everything at once, milder: 4% perspective, blur sigma 2, glare 60% over 30% of the width, 10% occlusion, noise 8 and JPEG quality 50.',
    perspective: 0.04,
    blurSigma: 2,
    glare: { strength: 0.6, radius: 0.3 },
    occlusion: 0.1,
    noiseSigma: 8,
    jpegQuality: 50,
  },
];

export async function decodeRaw(buf: Buffer): Promise<RawImage> {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), ...size(info) };
}

function size(info: { width: number; height: number }) {
  return { width: info.width, height: info.height };
}

type Pt = readonly [number, number];

/** Solve the 3x3 homography H (h33 = 1) mapping each src[i] to dst[i]. */
export function solveHomography(src: readonly Pt[], dst: readonly Pt[]): number[] {
  // 8 equations, 8 unknowns: Gauss-Jordan with partial pivoting.
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const d = a[col][col];
    for (let c = col; c < 9; c++) a[col][c] /= d;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = a[r][col];
      if (f === 0) continue;
      for (let c = col; c < 9; c++) a[r][c] -= f * a[col][c];
    }
  }
  return [...a.map((row) => row[8]), 1];
}

/**
 * Warp the image as if the card had been straightened imperfectly: each corner
 * of the output frame samples from a source point displaced by up to `amount`
 * of the frame size. Edges replicate.
 */
export function perspective(img: RawImage, rnd: () => number, amount: number): RawImage {
  const { width: w, height: h } = img;
  const jitter = (): number => (rnd() * 2 - 1) * amount;
  const outCorners: Pt[] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  const srcCorners: Pt[] = outCorners.map(([x, y]) => [x + jitter() * w, y + jitter() * h]);
  // Map output -> source, so every output pixel has a value.
  const H = solveHomography(outCorners, srcCorners);
  const out = new Uint8Array(img.data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const z = H[6] * px + H[7] * py + H[8];
      const sx = (H[0] * px + H[1] * py + H[2]) / z - 0.5;
      const sy = (H[3] * px + H[4] * py + H[5]) / z - 0.5;
      sampleBilinear(img, sx, sy, out, (y * w + x) * 3);
    }
  }
  return { data: out, width: w, height: h };
}

function sampleBilinear(img: RawImage, sx: number, sy: number, out: Uint8Array, o: number): void {
  const { width: w, height: h, data } = img;
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(sx)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(sy)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, sx - x0));
  const fy = Math.max(0, Math.min(1, sy - y0));
  for (let c = 0; c < 3; c++) {
    const top = data[(y0 * w + x0) * 3 + c] * (1 - fx) + data[(y0 * w + x1) * 3 + c] * fx;
    const bot = data[(y1 * w + x0) * 3 + c] * (1 - fx) + data[(y1 * w + x1) * 3 + c] * fx;
    out[o + c] = Math.round(top * (1 - fy) + bot * fy);
  }
}

/** Blend toward white with a radial falloff centered in the middle 60% of the frame. */
export function glare(
  img: RawImage,
  rnd: () => number,
  spec: { strength: number; radius: number }
): RawImage {
  const { width: w, height: h } = img;
  const cx = w * (0.2 + 0.6 * rnd());
  const cy = h * (0.2 + 0.6 * rnd());
  const r = spec.radius * w;
  const out = new Uint8Array(img.data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d >= 1) continue;
      const a = spec.strength * (1 - d * d);
      const i = (y * w + x) * 3;
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(out[i + c] + (255 - out[i + c]) * a);
    }
  }
  return { data: out, width: w, height: h };
}

/** Cover `fraction` of the area with a dark strip hugging one randomly chosen edge. */
export function occlude(img: RawImage, rnd: () => number, fraction: number): RawImage {
  const { width: w, height: h } = img;
  const out = new Uint8Array(img.data);
  const side = Math.floor(rnd() * 4); // 0 top, 1 bottom, 2 left, 3 right
  const horizontal = side < 2;
  const thickness = Math.round((horizontal ? h : w) * fraction);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const covered =
        side === 0
          ? y < thickness
          : side === 1
            ? y >= h - thickness
            : side === 2
              ? x < thickness
              : x >= w - thickness;
      if (!covered) continue;
      const i = (y * w + x) * 3;
      out[i] = 38;
      out[i + 1] = 38;
      out[i + 2] = 42;
    }
  }
  return { data: out, width: w, height: h };
}

export function addNoise(img: RawImage, rnd: () => number, sigma: number): RawImage {
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < out.length; i++) {
    const v = img.data[i] + gaussian(rnd) * sigma;
    out[i] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
  }
  return { data: out, width: img.width, height: img.height };
}

/**
 * Build one query image: `source` degraded by `condition`, deterministic in
 * (`cardId`, `condition.id`). The order is the order light and glass act on a
 * frame: geometry, glare, occlusion, optics, sensor, then the upload encode.
 */
export async function renderQuery(
  source: Buffer,
  condition: Condition,
  cardId: string
): Promise<Buffer> {
  if (condition.jpegQuality === undefined) return source;
  const rnd = mulberry32(seedFromString(`${cardId}:${condition.id}`));
  let img = await decodeRaw(source);
  if (condition.perspective) img = perspective(img, rnd, condition.perspective);
  if (condition.glare) img = glare(img, rnd, condition.glare);
  if (condition.occlusion) img = occlude(img, rnd, condition.occlusion);
  if (condition.blurSigma) {
    const { data, info } = await sharp(Buffer.from(img.data), {
      raw: { width: img.width, height: img.height, channels: 3 },
    })
      .blur(condition.blurSigma)
      .raw()
      .toBuffer({ resolveWithObject: true });
    img = { data: new Uint8Array(data.buffer, data.byteOffset, data.length), ...size(info) };
  }
  if (condition.noiseSigma) img = addNoise(img, rnd, condition.noiseSigma);
  return sharp(Buffer.from(img.data), {
    raw: { width: img.width, height: img.height, channels: 3 },
  })
    .jpeg({ quality: condition.jpegQuality })
    .toBuffer();
}
