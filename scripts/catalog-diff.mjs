#!/usr/bin/env node
// Compare two sets of catalog crops (scripts/catalog-shots.mjs output) and
// fail when a crop changed. Used by the nightly workflow: the baseline is the
// previous run's uploaded artifact, never a file in git.
//
//   node scripts/catalog-diff.mjs --baseline prev-shots --current catalog-shots --out catalog-diff
//
// Identical bytes short-circuit (a clean night decodes nothing). Crops whose
// bytes differ are decoded in the headless browser itself (canvas), so no PNG
// library is needed: a pixel counts as changed when any channel moves by more
// than TOLERANCE, and a crop as changed when at least MIN_PIXELS pixels did or
// its size differs. Each changed crop gets a diff PNG (baseline dimmed, changed
// pixels red) under --out. Added or removed crops (a new theme, a new section)
// are reported but do not fail: the next night's baseline includes them.
//
// Exit 0: nothing changed. Exit 1: at least one crop changed. Exit 2: bad usage.
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { executable } from './journey-browser.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const BASELINE = opt('--baseline', null);
const CURRENT = path.resolve(opt('--current', 'catalog-shots'));
const OUT = path.resolve(opt('--out', 'catalog-diff'));
const TOLERANCE = 8;
const MIN_PIXELS = 20;

async function walk(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full, base)));
    else if (e.name.endsWith('.png')) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

// Runs in the page: decode both PNGs, count changed pixels, draw the diff.
async function compareInPage(aB64, bB64, tolerance) {
  const load = (b64) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode failed'));
      img.src = `data:image/png;base64,${b64}`;
    });
  const [a, b] = await Promise.all([load(aB64), load(bB64)]);
  if (a.width !== b.width || a.height !== b.height) {
    return { sizeChanged: true, from: [a.width, a.height], to: [b.width, b.height], pixels: 0 };
  }
  const draw = (img) => {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, c.width, c.height);
  };
  const da = draw(a);
  const db = draw(b);
  const out = new ImageData(a.width, a.height);
  let pixels = 0;
  for (let i = 0; i < da.data.length; i += 4) {
    const moved =
      Math.abs(da.data[i] - db.data[i]) > tolerance ||
      Math.abs(da.data[i + 1] - db.data[i + 1]) > tolerance ||
      Math.abs(da.data[i + 2] - db.data[i + 2]) > tolerance ||
      Math.abs(da.data[i + 3] - db.data[i + 3]) > tolerance;
    if (moved) {
      pixels++;
      out.data.set([255, 0, 64, 255], i);
    } else {
      const grey = (da.data[i] + da.data[i + 1] + da.data[i + 2]) / 3;
      const v = grey * 0.4 + 140;
      out.data.set([v, v, v, 255], i);
    }
  }
  const c = document.createElement('canvas');
  c.width = a.width;
  c.height = a.height;
  c.getContext('2d').putImageData(out, 0, 0);
  return { sizeChanged: false, pixels, diff: c.toDataURL('image/png').split(',')[1] };
}

async function main() {
  if (!BASELINE) {
    console.error('catalog-diff: --baseline is required');
    process.exit(2);
  }
  const baseDir = path.resolve(BASELINE);
  const current = await walk(CURRENT);
  const baseline = new Set(await walk(baseDir).catch(() => []));
  if (baseline.size === 0) {
    console.log('catalog-diff: baseline is empty, nothing to compare (first run).');
    return;
  }
  const changed = [];
  const added = [];
  const suspects = [];
  for (const rel of current) {
    if (!baseline.has(rel)) {
      added.push(rel);
      continue;
    }
    const [a, b] = await Promise.all([
      readFile(path.join(baseDir, rel)),
      readFile(path.join(CURRENT, rel)),
    ]);
    if (!a.equals(b)) suspects.push({ rel, a, b });
  }
  const now = new Set(current);
  const removed = [...baseline].filter((rel) => !now.has(rel));

  if (suspects.length > 0) {
    const browser = await puppeteer.launch({
      executablePath: executable('chrome'),
      headless: true,
      args: ['--no-first-run', '--no-default-browser-check', '--disable-gpu'],
    });
    try {
      const page = await browser.newPage();
      await mkdir(OUT, { recursive: true });
      for (const { rel, a, b } of suspects) {
        const r = await page.evaluate(
          compareInPage,
          a.toString('base64'),
          b.toString('base64'),
          TOLERANCE
        );
        if (r.sizeChanged) {
          changed.push({ rel, reason: `size ${r.from.join('x')} -> ${r.to.join('x')}` });
        } else if (r.pixels >= MIN_PIXELS) {
          const file = path.join(OUT, rel);
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, Buffer.from(r.diff, 'base64'));
          changed.push({ rel, reason: `${r.pixels} pixels changed` });
        }
      }
    } finally {
      await browser.close();
    }
  }

  const report = { compared: current.length, changed, added, removed };
  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(
    `catalog-diff: ${current.length} crops, ${changed.length} changed, ${added.length} added, ${removed.length} removed`
  );
  for (const c of changed) console.log(`  CHANGED ${c.rel}: ${c.reason}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      '## Component catalog',
      `${current.length} crops compared with the previous run: **${changed.length} changed**, ${added.length} added, ${removed.length} removed.`,
      ...changed.slice(0, 60).map((c) => `- \`${c.rel}\`: ${c.reason}`),
      changed.length > 0 ? '\nDiff images are in the `catalog-diff` artifact.' : '',
    ];
    await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }
  if (changed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
