// Boot payload budget — what a cold visit downloads before the app can paint.
//
// Reads dist/index.html, sums the gzipped size of every `modulepreload`ed
// script (the entry's whole static import graph: the browser fetches all of
// it before the entry runs) and of the render-blocking stylesheet(s), and
// fails when either exceeds its budget. Runs in CI after `npm run build`.
//
// Budgets are set a hair above the measured baseline so growth is a decision,
// not a drift: JS from the 2026-09-09 prod reading (396 KB); CSS from the
// 2026-09-09 page-level split (E265 — the play table, editor-only, new-deck,
// combos-list, import-dialog and scanner/admin sheets moved into their page
// chunks: 99 KB → 76 KB gzipped at gzip -6 of dist). Raising one is fine —
// say why in the commit that raises it. Lowering one when a split lands keeps
// the ratchet honest — which is why CSS came down to 68 on 2026-09-22, when the
// mana-font + keyrune glyph sheets (13.7 KB gzipped between them, the two
// largest items in the payload and neither one ours) moved off the critical
// path into a dynamic import. 80 → 65 measured; 68 leaves the same slim margin
// over the measurement that every other number here does. CSS went 68 → 69 on
// 2026-09-26 for the foil engine rebuild (holographic.css: three layers, ten
// finishes, the seam guard's geometry): main measured 67.41, the rebuild 68.03,
// i.e. +0.6 KB into a 0.59 KB margin. It cannot leave the critical path: the
// foil layers render in the CardPreview chunk, which the entry modulepreloads.
// Its grain textures already moved out to public/foil/*.svg to keep it at that.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUDGET_KB = { js: 410, css: 69 };

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
// Vite emits multi-line <link> tags; a line-based scan misses them.
const html = readFileSync(resolve(dist, 'index.html'), 'utf8').replace(/\s+/g, ' ');

const hrefs = (re) => [...html.matchAll(re)].map((m) => m[1]);
const scripts = new Set([
  ...hrefs(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g),
  ...hrefs(/<script[^>]*type="module"[^>]*src="([^"]+)"/g),
]);
const styles = hrefs(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g);

const gz = (href) => gzipSync(readFileSync(resolve(dist, '.' + href))).length;
const table = (list) =>
  [...list].map((h) => ({ href: h, kb: gz(h) / 1024 })).sort((a, b) => b.kb - a.kb);

const js = table(scripts);
const css = table(styles);
const total = (rows) => rows.reduce((n, r) => n + r.kb, 0);

const report = (label, rows, budget) => {
  const sum = total(rows);
  const ok = sum <= budget;
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} ${label}: ${sum.toFixed(0)} KB gzipped across ${rows.length} files (budget ${budget} KB)`
  );
  for (const r of rows.slice(0, 8)) console.log(`      ${r.kb.toFixed(1).padStart(6)} KB  ${r.href}`);
  return ok;
};

const jsOk = report('boot JS (module preloads)', js, BUDGET_KB.js);
const cssOk = report('render-blocking CSS', css, BUDGET_KB.css);
if (!jsOk || !cssOk) {
  console.error(
    '\nBoot payload over budget. Either move the growth behind a lazy import / route chunk, ' +
      'or raise BUDGET_KB in frontend/scripts/check-boot-budget.mjs and say why in the commit.'
  );
  process.exit(1);
}
