#!/usr/bin/env node
// Fails if a packages/* shared package is missing from somewhere that must
// register it. Run by ci.yml on every PR; also runnable locally with
// `node scripts/check-shared-package-registration.mjs`.
//
// WHY THIS EXISTS
// The apps consume packages/* as `file:` deps whose dist/ is gitignored. npm
// therefore runs each package's dist-guarded `prepare` during the consumer's
// `npm ci`, with none of that package's devDependencies installed, and tsc dies
// on "TS2688: Cannot find type definition file for 'node'". The fix is always
// the same — build the package BEFORE the consumer installs — but it has to be
// repeated in every place that installs a consumer, and the ones that aren't
// PR checks (cron ingests, release builds, the image build) fail weeks later,
// far from the change that broke them:
//   #312/#314   binder-routing added, backend/Dockerfile not updated
//   #1637       deck-metrics shipped without its runtime image copy
//   #1706-era   deck-metrics missing from scanner/combo/android; Scanner Ingest
//               broke on a cron with nothing wrong in the diff
// Each was a comment-documented invariant that a comment could not enforce.
//
// WHAT IT CHECKS
// Requirements are derived from the actual `file:` deps in backend/ and
// frontend/package.json, not a hardcoded list, so a new shared package or a new
// workflow is covered the day it lands:
//   1. Every workflow job that runs a real `npm ci` for a consumer must first
//      build each packages/* that consumer depends on.
//   2. backend/Dockerfile's build stage must do the same before each app installs.
//   3. Its runtime stage must COPY the dist of every package the BACKEND depends
//      on (the frontend's are bundled at build time and don't ship separately).
// "First" is enforced by position, not mere presence — a build step after the
// install is exactly as broken as no build step at all.
//
// An `npm ci --ignore-scripts` is deliberately exempt: it never runs `prepare`,
// which is how refresh-snapshots.yml installs the frontend without needing any
// package built.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONSUMERS = ['backend', 'frontend'];
const errors = [];

/** packages/* each consumer takes a `file:` dependency on. */
function fileDepsOf(consumer) {
  const pkg = JSON.parse(readFileSync(resolve(root, consumer, 'package.json'), 'utf8'));
  return Object.values({ ...pkg.dependencies, ...pkg.devDependencies })
    .map((spec) => /^file:\.\.\/packages\/(.+)$/.exec(spec)?.[1])
    .filter(Boolean)
    .sort();
}

const deps = Object.fromEntries(CONSUMERS.map((c) => [c, fileDepsOf(c)]));

// Every package on disk must be a dependency of something, or it is dead weight
// nothing builds — worth knowing about, and cheap to catch here.
const onDisk = readdirSync(resolve(root, 'packages'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);
for (const pkg of onDisk) {
  if (!CONSUMERS.some((c) => deps[c].includes(pkg))) {
    errors.push(
      `packages/${pkg} is not a file: dependency of ${CONSUMERS.join(' or ')} — dead package, or a missing dependency?`
    );
  }
}

// ---------------------------------------------------------------- workflows

const stepText = (step) => `${step?.run ?? ''}\n${step?.['working-directory'] ?? ''}`;

/** Which consumer, if any, this step installs with a scripts-running `npm ci`. */
function installedConsumer(step, jobDefaultDir) {
  const run = step?.run ?? '';
  if (!/\bnpm\b[^\n]*\bci\b/.test(run)) return null;
  if (/--ignore-scripts/.test(run)) return null; // never runs `prepare`
  const prefixed = /npm\s+--prefix\s+(backend|frontend)\s+ci/.exec(run);
  if (prefixed) return prefixed[1];
  const dir = step['working-directory'] ?? jobDefaultDir;
  return CONSUMERS.includes(dir) ? dir : null;
}

/** Does this step build packages/<pkg>? */
function buildsPackage(step, pkg) {
  const text = stepText(step);
  if (!text.includes(`packages/${pkg}`)) return false;
  return /\brun\s+build\b/.test(text) || /npm run build/.test(text);
}

const workflowDir = resolve(root, '.github/workflows');
for (const file of readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f))) {
  const wf = parseYaml(readFileSync(resolve(workflowDir, file), 'utf8'));
  for (const [jobName, job] of Object.entries(wf?.jobs ?? {})) {
    const steps = job?.steps;
    if (!Array.isArray(steps)) continue;
    const jobDefaultDir = job?.defaults?.run?.['working-directory'];

    steps.forEach((step, installIdx) => {
      const consumer = installedConsumer(step, jobDefaultDir);
      if (!consumer) return;
      for (const pkg of deps[consumer]) {
        const buildIdx = steps.findIndex((s) => buildsPackage(s, pkg));
        if (buildIdx === -1) {
          errors.push(
            `.github/workflows/${file} job "${jobName}" installs ${consumer} (step ${installIdx + 1}) ` +
              `but never builds packages/${pkg}, which ${consumer} takes a file: dep on. ` +
              `Its prepare will run without devDependencies → TS2688.`
          );
        } else if (buildIdx > installIdx) {
          errors.push(
            `.github/workflows/${file} job "${jobName}" builds packages/${pkg} (step ${buildIdx + 1}) ` +
              `AFTER installing ${consumer} (step ${installIdx + 1}). The build must come first.`
          );
        }
      }
    });
  }
}

// --------------------------------------------------------------- Dockerfile

const dockerfilePath = 'backend/Dockerfile';
const lines = readFileSync(resolve(root, dockerfilePath), 'utf8').split('\n');

// Everything from the second FROM on is the runtime stage.
const fromIdxs = lines.flatMap((l, i) => (/^FROM /.test(l) ? [i] : []));
const runtimeStart = fromIdxs[1] ?? lines.length;

// Build stage: each app's install must be preceded by a build of every package
// it depends on. Reported per package (not per consumer) so a package both apps
// depend on doesn't produce the same finding twice.
const buildStageInstall = {};
for (const consumer of CONSUMERS) {
  const idx = lines.findIndex(
    (l, i) =>
      i < runtimeStart && new RegExp(`npm --prefix ${consumer} ci`).test(l) && !/--omit=dev/.test(l)
  );
  if (idx === -1) {
    errors.push(
      `${dockerfilePath}: no build-stage \`npm --prefix ${consumer} ci\` found — has this file been restructured?`
    );
  } else {
    buildStageInstall[consumer] = idx;
  }
}

for (const pkg of [...new Set(CONSUMERS.flatMap((c) => deps[c]))]) {
  const needers = CONSUMERS.filter(
    (c) => deps[c].includes(pkg) && buildStageInstall[c] !== undefined
  );
  if (!needers.length) continue;
  // Must precede the EARLIEST install that depends on it.
  const deadline = Math.min(...needers.map((c) => buildStageInstall[c]));
  const buildIdx = lines.findIndex(
    (l, i) => i < runtimeStart && new RegExp(`npm --prefix packages/${pkg} run build`).test(l)
  );
  const who = needers.join(' and ');
  if (buildIdx === -1) {
    errors.push(
      `${dockerfilePath} build stage never builds packages/${pkg}, which ${who} depend${needers.length > 1 ? '' : 's'} on.`
    );
  } else if (buildIdx > deadline) {
    errors.push(
      `${dockerfilePath} build stage builds packages/${pkg} (line ${buildIdx + 1}) after installing ` +
        `${needers.find((c) => buildStageInstall[c] === deadline)} (line ${deadline + 1}).`
    );
  }
}

// Runtime stage: the backend's file: deps are linked at runtime, so each needs
// its package.json + prebuilt dist copied in before the prod install resolves
// the link. Frontend-only packages are bundled into the web build and correctly
// absent here — that distinction is why this checks backend deps only.
const runtimeInstallIdx = lines.findIndex(
  (l, i) => i >= runtimeStart && /npm --prefix backend ci --omit=dev/.test(l)
);
if (runtimeInstallIdx === -1) {
  errors.push(
    `${dockerfilePath}: no runtime-stage \`npm --prefix backend ci --omit=dev\` found — has this file been restructured?`
  );
} else {
  for (const pkg of deps.backend) {
    const copyDist = lines.findIndex(
      (l, i) =>
        i >= runtimeStart && new RegExp(`COPY --from=build /app/packages/${pkg}/dist`).test(l)
    );
    const copyManifest = lines.findIndex(
      (l, i) => i >= runtimeStart && new RegExp(`COPY packages/${pkg}/package.json`).test(l)
    );
    for (const [what, idx] of [
      ['dist', copyDist],
      ['package.json', copyManifest],
    ]) {
      if (idx === -1) {
        errors.push(
          `${dockerfilePath} runtime stage never copies packages/${pkg}'s ${what}, but the backend takes a file: dep on it — ` +
            `\`npm ci --omit=dev\` cannot resolve the link. (This is the #1637 trap; CI cannot catch it, only the image build can.)`
        );
      } else if (idx > runtimeInstallIdx) {
        errors.push(
          `${dockerfilePath} runtime stage copies packages/${pkg}'s ${what} (line ${idx + 1}) after the prod install (line ${runtimeInstallIdx + 1}).`
        );
      }
    }
  }
}

// ------------------------------------------------------------------ report

const summary = CONSUMERS.map(
  (c) => `${c} → ${deps[c].map((p) => `packages/${p}`).join(', ') || '(none)'}`
).join('; ');
// A package both apps depend on would otherwise report the same Dockerfile
// build-stage gap once per consumer.
const unique = [...new Set(errors)];
if (unique.length) {
  console.error(`Shared package registration is incomplete (${summary}):\n`);
  for (const e of unique) console.error(`  ✗ ${e}\n`);
  console.error(
    'Every place that installs a consumer must build its file: deps first. See the header of this script.'
  );
  process.exit(1);
}
console.log(`Shared package registration OK — ${summary}`);
