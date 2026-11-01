#!/usr/bin/env node
// Guard: no source file in packages/*/src grows past MAX_LINES, and the files
// already past it only shrink. The shared-package twin of
// frontend/src/test/file-size-ratchet.test.ts and backend/src/file-size-ratchet.test.ts;
// read the frontend header for the reasoning (board E1080).
//
// The packages have no shared test runner, so this is a plain Node script run
// by CI's `shared packages — registration` job. Run it locally with
// `node scripts/check-file-size-ratchet.mjs`.
//
// HOW IT RATCHETS. A file not in CEILINGS may not exceed MAX_LINES. A file in
// CEILINGS may not exceed its ceiling, which is its size when this guard
// landed. When a split shrinks a file by more than SLACK lines the stale check
// asks for the ceiling to come down with it, and a file back under MAX_LINES
// leaves the list. Never raise a ceiling or add an entry: split the file
// instead (extract a pure helper next to it, keep the index exports identical).
//
// Tests and *.fixtures.ts / *.d.ts are exempt: they are tables and oracles, not
// the code a reader has to hold in their head. Every packages/* directory is
// walked, so a new shared package is covered without editing this file.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MAX_LINES = 1000;
/** A ceiling this far above the file's real size is stale. */
const SLACK = 50;

/** Paths are relative to the repo root. Sizes are `split('\n').length`. */
const CEILINGS = {
  'packages/game-core/src/index.ts': 2085,
  'packages/deck-metrics/src/index.ts': 1134,
};

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry !== 'node_modules' && entry !== 'dist') sourceFiles(p, out);
    } else if (/\.tsx?$/.test(entry) && !/\.(test|fixtures|d)\.tsx?$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

const sizes = new Map();
for (const pkg of readdirSync(join(ROOT, 'packages'))) {
  const src = join(ROOT, 'packages', pkg, 'src');
  try {
    if (!statSync(src).isDirectory()) continue;
  } catch {
    continue;
  }
  for (const f of sourceFiles(src)) {
    sizes.set(relative(ROOT, f).split(sep).join('/'), readFileSync(f, 'utf8').split('\n').length);
  }
}

const problems = [];
if (sizes.size < 20)
  problems.push(`  walked only ${sizes.size} files, the packages/*/src walk is broken`);

for (const [f, n] of sizes) {
  const limit = CEILINGS[f] ?? MAX_LINES;
  if (n > limit)
    problems.push(`  ${f}: ${n} lines (limit ${limit}), split the file instead of growing it`);
}
for (const [f, ceiling] of Object.entries(CEILINGS)) {
  const n = sizes.get(f);
  if (n === undefined) problems.push(`  ${f}: gone, delete the CEILINGS entry`);
  else if (n <= MAX_LINES)
    problems.push(`  ${f}: ${n} lines, under ${MAX_LINES}, delete the CEILINGS entry`);
  else if (ceiling - n > SLACK)
    problems.push(`  ${f}: ${n} lines, lower the ceiling ${ceiling} -> ${n}`);
}

if (problems.length) {
  console.error(
    'File size ratchet failed (never raise a ceiling, see the header of scripts/check-file-size-ratchet.mjs):'
  );
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`file size ratchet ok: ${sizes.size} files under packages/*/src`);
