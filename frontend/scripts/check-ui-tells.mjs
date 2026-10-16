#!/usr/bin/env node
/**
 * check-ui-tells.mjs: the UI-tells detector as a ratchet (`npm run lint:ui`).
 *
 * Runs the pinned `impeccable detect` (devDependency, exact version) over
 * `src/` and compares its primary findings, counted per rule and file, with
 * `scripts/ui-tells.baseline.json`. A rule/file pair that is new, or whose
 * count rose, fails. The baseline is empty: the tree has no primary findings,
 * and the only way to keep one is a value-scoped ignore with a reason in
 * `.impeccable/config.json`, or an `impeccable-disable-next-line <rule> --
 * <reason>` comment where the rule has no value to scope by (side-tab,
 * layout-transition). Advisory findings never count.
 *
 * Why: trove plugins/polish/reference/ui-tells.md, "Enforcement": a written
 * rule alone drifted back; a mechanical check holds the line. The repo's own
 * guards (styles/one-sided-stripe, styles/layout-transition, the motion and
 * uppercase guards) state each rule; this runs the outside catalog over the
 * same tree so a tell the guards don't know yet still surfaces.
 *
 *   npm run lint:ui                               # check
 *   UPDATE_UI_TELLS_BASELINE=1 npm run lint:ui    # write a LOWER baseline only
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(root, 'scripts', 'ui-tells.baseline.json');
const require = createRequire(join(root, 'package.json'));
const cli = join(dirname(require.resolve('impeccable/package.json')), 'cli', 'bin', 'cli.js');

const run = spawnSync(process.execPath, [cli, 'detect', '--json', '--no-advisory', 'src'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
// 0 = clean, 2 = findings; anything else means a target could not be scanned.
if (run.status !== 0 && run.status !== 2) {
  process.stderr.write(run.stderr || run.stdout || `impeccable exited ${run.status}\n`);
  console.error(`lint:ui: the detector could not scan src/ (exit ${run.status})`);
  process.exit(1);
}

let findings;
try {
  findings = JSON.parse(run.stdout || '[]');
} catch {
  process.stderr.write(run.stdout);
  console.error('lint:ui: the detector did not print JSON');
  process.exit(1);
}
const primary = (Array.isArray(findings) ? findings : (findings.findings ?? [])).filter(
  (f) => !f.advisory && f.severity !== 'advisory'
);

const key = (f) => `${f.antipattern} ${relative(root, f.file).split('\\').join('/')}`;
const counts = {};
for (const f of primary) counts[key(f)] = (counts[key(f)] ?? 0) + 1;

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {};
const rose = Object.entries(counts)
  .filter(([k, n]) => n > (baseline[k] ?? 0))
  .map(([k, n]) => `${k}: ${baseline[k] ?? 0} -> ${n}`);
const fell = Object.entries(baseline)
  .filter(([k, n]) => (counts[k] ?? 0) < n)
  .map(([k, n]) => `${k}: ${n} -> ${counts[k] ?? 0}`);

if (process.env.UPDATE_UI_TELLS_BASELINE) {
  if (rose.length) {
    console.error(`lint:ui: refusing to raise the baseline:\n  ${rose.join('\n  ')}`);
    process.exit(1);
  }
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(baselinePath, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`lint:ui: baseline written (${primary.length} findings)`);
  process.exit(0);
}

for (const f of primary.filter((f) => rose.some((r) => r.startsWith(key(f) + ':')))) {
  console.error(`  ${key(f)}:${f.line}  ${f.name}: ${f.snippet ?? ''}`);
}
if (rose.length) {
  console.error(
    `lint:ui: new UI tells (see STYLE_GUIDE.md and trove plugins/polish/reference/ui-tells.md):\n  ${rose.join('\n  ')}\n` +
      'Fix the tell. A deliberate case takes a value-scoped ignore with a reason in .impeccable/config.json,\n' +
      'or an `impeccable-disable-next-line <rule> -- <reason>` comment where the rule has no value to scope.'
  );
  process.exit(1);
}
if (fell.length) {
  console.error(
    `lint:ui: these improved. Lock it in: UPDATE_UI_TELLS_BASELINE=1 npm run lint:ui\n  ${fell.join('\n  ')}`
  );
  process.exit(1);
}
console.log(`lint:ui: ${primary.length} primary findings, none above the baseline`);
