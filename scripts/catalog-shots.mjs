#!/usr/bin/env node
// Component catalog photographs (board T176 W3).
//
// Loads /dev/catalog once per (theme, type set) pair per viewport (see PAIRS)
// and writes one PNG per specimen section (an element crop keyed on data-catalog-section):
//
//   <out>/<viewport>/<theme>__<typeset>/<section>.png
//
// The nightly workflow compares these with the previous run's set
// (scripts/catalog-diff.mjs). Nothing is committed: the baseline is the last
// uploaded artifact, so no PNG ever lands in git.
//
//   node scripts/catalog-shots.mjs --base http://localhost:3737 --out catalog-shots
//   node scripts/catalog-shots.mjs --themes azorius,obsidian --typesets codex --viewports phone
//   node scripts/catalog-shots.mjs --matrix full   # every theme x every type set
//
// Determinism: animations, transitions and the caret are switched off, the
// page reports ready only after web fonts settle, and the catalog carries no
// network content, so an unchanged UI produces byte-identical files.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { TIERS, executable } from './journey-browser.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const BASE = opt('--base', 'http://localhost:3737').replace(/\/$/, '');
const BROWSER = opt('--browser', 'chrome');
const OUT = path.resolve(opt('--out', 'catalog-shots'));
const VIEWPORTS = opt('--viewports', 'phone,desktop').split(',');

// The id lists come from the registries themselves, so a new theme or type set
// is photographed the night after it lands with no edit here.
const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const ids = (file) => [...read(file).matchAll(/^\s{4}id: '([a-z-]+)',/gm)].map((m) => m[1]);
const constant = (file, name) =>
  read(file).match(new RegExp(`export const ${name} = '([a-z-]+)'`))[1];
const THEMES_TS = '../frontend/src/lib/account/themes.ts';
const TYPESETS_TS = '../frontend/src/lib/account/typesets.ts';
const pick = (flag, all) => (opt(flag, 'all') === 'all' ? all : opt(flag, '').split(','));
const THEMES = pick('--themes', ids(THEMES_TS));
const TYPESETS = pick('--typesets', ids(TYPESETS_TS));
const DEFAULT_THEME = constant(THEMES_TS, 'DEFAULT_THEME');
const DEFAULT_TYPESET = constant(TYPESETS_TS, 'DEFAULT_TYPESET');

// Which (theme, type set) pairs to shoot. The default, `--matrix axes`, is
// every theme in the default type set plus every type set in the default
// theme: 17 pairs rather than 77. A theme changes colour and a type set
// changes metrics, and a primitive's look doesn't depend on the two together,
// so the full cross product mostly photographs one change 7 or 11 times.
// `--matrix full` is there for a restyle where they do interact.
const PAIRS =
  opt('--matrix', 'axes') === 'full'
    ? THEMES.flatMap((theme) => TYPESETS.map((typeset) => [theme, typeset]))
    : [
        ...THEMES.map((theme) => [theme, DEFAULT_TYPESET]),
        ...TYPESETS.filter((t) => t !== DEFAULT_TYPESET).map((t) => [DEFAULT_THEME, t]),
      ];

const FREEZE = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}`;

async function main() {
  const browser = await puppeteer.launch({
    browser: BROWSER,
    executablePath: executable(BROWSER),
    headless: true,
    protocolTimeout: 300_000,
    args:
      BROWSER === 'firefox'
        ? []
        : [
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-gpu',
            '--font-render-hinting=none',
          ],
  });
  let shots = 0;
  const problems = [];
  try {
    for (const tierName of VIEWPORTS) {
      const tier = TIERS[tierName];
      if (!tier) throw new Error(`unknown viewport ${tierName}`);
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setViewport(tier);
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
      for (const [theme, typeset] of PAIRS) {
        const dir = path.join(OUT, tierName, `${theme}__${typeset}`);
        await mkdir(dir, { recursive: true });
        errors.length = 0;
        await page.goto(`${BASE}/dev/catalog?theme=${theme}&typeset=${typeset}`, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
        await page.addStyleTag({ content: FREEZE });
        try {
          await page.waitForSelector('[data-catalog-ready="true"]', { timeout: 30_000 });
        } catch {
          problems.push(`${tierName} ${theme}/${typeset}: catalog never reported ready`);
          continue;
        }
        // Lazy images below the fold never load on their own (nothing scrolls),
        // so the phone crops of the card section came out blank. Load and
        // decode every image before the first crop.
        await page.evaluate(async () => {
          const imgs = [...document.images];
          for (const img of imgs) img.loading = 'eager';
          await Promise.all(imgs.map((img) => img.decode().catch(() => {})));
        });
        const sections = await page.$$('[data-catalog-section]');
        if (sections.length === 0) problems.push(`${tierName} ${theme}/${typeset}: no sections`);
        for (const el of sections) {
          const id = await el.evaluate((n) => n.getAttribute('data-catalog-section'));
          // Clip by page coordinates instead of el.screenshot(): that scrolls
          // the element into view first, and on the phone tier it clipped the
          // first line off a wrapping title.
          const box = await el.evaluate((n) => {
            const r = n.getBoundingClientRect();
            return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
          });
          await page.screenshot({
            path: path.join(dir, `${id}.png`),
            clip: box,
            captureBeyondViewport: true,
          });
          shots++;
        }
        if (errors.length) problems.push(`${tierName} ${theme}/${typeset}: ${errors[0]}`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`catalog-shots: ${shots} crops in ${OUT}`);
  if (problems.length) {
    console.error(problems.map((p) => `  ${p}`).join('\n'));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
