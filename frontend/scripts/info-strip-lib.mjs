// Shared helpers for the info-strip picker's evaluation script
// (info-strip-eval.mjs). Renders a real Scryfall card
// image the way the scanner sees it: warped to 488x680, grayscale, then
// degraded to phone-camera quality.
import sharp from 'sharp';

export const WARP_W = 488;
export const WARP_H = 680;

/** Small deterministic PRNG so degradations are reproducible. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Render an image buffer as the scanner's warp, then degrade it.
 * opts: { scale: camera resolution relative to the warp (<1 softens),
 *         blur: gaussian sigma, angle: degrees of skew, shift: [dx, dy] px,
 *         noise: gaussian sigma on 0..255, seed }
 */
export async function renderWarp(buf, opts = {}) {
  const { scale = 1, blur = 0, angle = 0, shift = [0, 0], noise = 0, seed = 1 } = opts;
  let img = sharp(buf).resize(WARP_W, WARP_H, { fit: 'fill' }).greyscale();
  if (scale < 1) {
    const small = await img
      .resize(Math.round(WARP_W * scale), Math.round(WARP_H * scale), { kernel: 'lanczos3' })
      .toBuffer();
    img = sharp(small).resize(WARP_W, WARP_H, { kernel: 'cubic' });
  }
  if (blur > 0.3) img = img.blur(blur);
  const raw = await img.toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
  if (raw.info.channels !== 1) throw new Error(`expected 1 channel, got ${raw.info.channels}`);
  let data = raw.data;
  if (angle !== 0 || shift[0] !== 0 || shift[1] !== 0) {
    const rot = await sharp(data, { raw: { width: WARP_W, height: WARP_H, channels: 1 } })
      .rotate(angle, { background: '#000', kernel: 'cubic' })
      .toColourspace('b-w')
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (rot.info.channels !== 1) throw new Error(`rotate gave ${rot.info.channels} channels`);
    const ox = Math.round((rot.info.width - WARP_W) / 2) - shift[0];
    const oy = Math.round((rot.info.height - WARP_H) / 2) - shift[1];
    const out = new Uint8Array(WARP_W * WARP_H);
    for (let y = 0; y < WARP_H; y++) {
      for (let x = 0; x < WARP_W; x++) {
        const sx = x + ox;
        const sy = y + oy;
        if (sx >= 0 && sy >= 0 && sx < rot.info.width && sy < rot.info.height) {
          out[y * WARP_W + x] = rot.data[sy * rot.info.width + sx];
        }
      }
    }
    data = out;
  }
  if (noise > 0) {
    const r = rng(seed);
    const out = new Uint8Array(data);
    for (let i = 0; i < out.length; i++) {
      const g = Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());
      out[i] = Math.max(0, Math.min(255, out[i] + g * noise));
    }
    data = out;
  }
  return { data, width: WARP_W, height: WARP_H };
}

/** The degradation ladder the evaluation reports on. */
export const LEVELS = {
  clean: {},
  mild: { scale: 0.8, blur: 0.5, angle: 0.5, shift: [1, 0], noise: 3 },
  phone: { scale: 0.65, blur: 0.7, angle: -1, shift: [-1, 1], noise: 5 },
  rough: { scale: 0.55, blur: 0.9, angle: 1.5, shift: [1, -1], noise: 8 },
};
