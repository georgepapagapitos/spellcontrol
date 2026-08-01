// @vitest-environment node
//
// Guard: no test may read a public/ asset that predev/prebuild regenerate.
//
// `frontend/predev` and `frontend/prebuild` run refresh-tagger.mjs,
// refresh-rules.mjs and refresh-sld-drops.mjs, each of which REWRITES its
// git-tracked file in public/ in place once the local copy ages past that
// script's threshold. CI never runs those hooks, so it always scores against
// the committed revision — but any dev who had run `npm run dev` or
// `npm run build` scored against a newer one.
//
// That divergence is invisible: the test file didn't change, the source didn't
// change, and CI stays green, so a failure reads as "my branch broke the eval"
// when the real answer is "your working copy has different input data". It cost
// a real debugging session on substituteFinder.eval, where the suspicion landed
// on the similarity weights (which are validated, and were fine).
//
// Tests that need this data must read a pinned fixture instead — see
// scripts/refresh-tagger-eval-fixture.mjs and the two deck-builder evals.
//
// `.live.test.ts` files are exempt: they are opt-in, env-gated harnesses that
// deliberately run against current real data and never run in CI.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const selfPath = fileURLToPath(import.meta.url);
const srcDir = resolve(dirname(selfPath), '..');

/** Written in place by the predev/prebuild refresh scripts. */
const REGENERATED_ASSETS = [
  'tagger-tags.json',
  'otag-index.json',
  'comprehensive-rules.json',
  'sld-drops.json',
];

/**
 * Deliberate exceptions — tests whose whole point is to track whatever snapshot
 * is currently bundled, and whose failure names its own fix.
 *
 * `otag-descriptions` asserts every tag key in the snapshot has a human
 * description. If a refresh pulls a new upstream tag, this test SHOULD go red
 * locally: the message is "tag X has no description", which is actionable on
 * sight. That is the opposite of the failure this guard exists to prevent — an
 * eval's nDCG floor silently scoring against different data and sending someone
 * off to retune validated weights.
 */
const ALLOWED = new Set(['lib/otag-descriptions.test.ts']);

function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) testFiles(full, out);
    else if (/\.test\.tsx?$/.test(entry) && !entry.includes('.live.')) out.push(full);
  }
  return out;
}

/**
 * Comments are where these filenames legitimately appear — every fixed eval
 * explains in prose why it no longer reads the generated asset. Only a mention
 * in real code is a read.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('generated public/ assets stay out of the test suite', () => {
  it('no non-live test reads a predev/prebuild-regenerated asset', () => {
    const offenders: string[] = [];

    for (const file of testFiles(srcDir)) {
      const rel = file.slice(srcDir.length + 1);
      if (file === selfPath) continue; // this guard names the assets on purpose
      if (ALLOWED.has(rel)) continue;
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const asset of REGENERATED_ASSETS) {
        if (code.includes(asset)) offenders.push(`${rel} -> public/${asset}`);
      }
    }

    expect(
      offenders,
      `These tests read a public/ asset that predev/prebuild rewrite in place, so they score ` +
        `differently on a machine where the app has been run than they do in CI. Pin a committed ` +
        `fixture instead (see scripts/refresh-tagger-eval-fixture.mjs).\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });
});
