#!/usr/bin/env node
// Fails a pull request that deletes a *.test.ts / *.test.tsx file without a
// `## Deleted tests` section in its body naming every deleted file. Run by
// ci.yml on pull requests; runnable locally:
//
//   node scripts/check-deleted-tests.mjs --base "$(git merge-base origin/main HEAD)" \
//        --body-file /path/to/pr-body.md
//
// WHY THIS EXISTS
// #3210 removed DeckIdeaPage.test and IdeaStart.test together with the code they
// covered. Four user-visible behaviors went with them (owned-commander printing,
// the idea link surviving "Change idea", the idea-index error and unknown-slug
// states) and nobody noticed until a per-PR audit; #3224 and #3227 restored them.
// A deleted test is the one change a green CI cannot object to, so the PR has to
// say where each assertion went.
//
// WHAT COUNTS AS A DELETION
// Evidence from main since 2026-09-01: about 470 test-file renames, all but a
// handful at 70% similarity or better, and one part-split (#2654) which git
// records as new `<name>.part-N.test.ts` files plus a rename of the original to
// a non-test file. So:
//   - a deleted file is a deletion;
//   - a rename whose destination is still a test file and which git pairs at
//     70% or better is a move, not a deletion; below that the old file is
//     treated as deleted (a rewrite that drops most of a file is what this
//     check is for);
//   - a file whose name is `<name>.test.ext`, and which has a sibling
//     `<name>.part-N.test.ext` added in the same change, is a part-split move;
//   - a rename to a name that is no longer a test file is a deletion of the test.
// Pushes to main and merge-queue runs are skipped: the PR run already decided.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_FILE = /\.test\.tsx?$/;
const RENAME_THRESHOLD = 70;
const MIN_EXPLANATION_CHARS = 12;

/** Parse `git diff --name-status -z` output into {status, path, from?} entries. */
export function parseNameStatus(raw) {
  const parts = raw.split('\0');
  if (parts.at(-1) === '') parts.pop();
  const entries = [];
  for (let i = 0; i < parts.length;) {
    const code = parts[i++];
    const letter = code[0];
    if (letter === 'R' || letter === 'C') {
      const from = parts[i++];
      const path = parts[i++];
      entries.push({ status: letter, score: Number(code.slice(1)) || 0, from, path });
    } else {
      entries.push({ status: letter, score: 0, path: parts[i++] });
    }
  }
  return entries;
}

const partPattern = (path) => {
  const m = /^(.*)\.test\.(tsx?)$/.exec(path);
  if (!m) return null;
  const escaped = posix.basename(m[1]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}\\.part-\\d+\\.test\\.tsx?$`);
};

/** Test files this change deletes, after treating moves and part-splits as moves. */
export function findDeletedTests(entries) {
  const gone = [];
  for (const e of entries) {
    if (e.status === 'D' && TEST_FILE.test(e.path)) gone.push(e.path);
    else if (e.status === 'R' && TEST_FILE.test(e.from)) {
      if (!TEST_FILE.test(e.path) || e.score < RENAME_THRESHOLD) gone.push(e.from);
    }
  }
  const arrivals = entries
    .filter(
      (e) => (e.status === 'A' || e.status === 'R' || e.status === 'C') && TEST_FILE.test(e.path)
    )
    .map((e) => e.path);
  return gone.filter((path) => {
    const re = partPattern(path);
    const dir = posix.dirname(path);
    // Same directory only: a part file elsewhere is not this file's split.
    return !(re && arrivals.some((a) => posix.dirname(a) === dir && re.test(posix.basename(a))));
  });
}

/** Text under a `## Deleted tests` heading, up to the next heading; null if absent. */
export function extractSection(body) {
  const text = (body ?? '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  const lines = text.split('\n');
  let inFence = false;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (!inFence && /^##\s+deleted tests\s*#*\s*$/i.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return null;
  const out = [];
  inFence = false;
  for (let i = start; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (!inFence && /^#{1,2}\s+\S/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

const indentOf = (line) => /^\s*/.exec(line)[0].length;
const TOKEN = /[\w@.\-/]+\.test\.tsx?/g;

/** For one deleted path, the explanation text the section gives it, or null if unnamed. */
function entryText(section, path) {
  const lines = section.split('\n');
  const names = (line) =>
    (line.match(TOKEN) ?? []).filter((t) => path === t || path.endsWith(`/${t}`));
  const idx = lines.findIndex((l) => names(l).length > 0);
  if (idx < 0) return null;
  const base = indentOf(lines[idx]);
  const chunk = [lines[idx]];
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') break;
    if (indentOf(l) <= base && /^\s*([-*+]|\d+\.)\s/.test(l)) break;
    chunk.push(l);
  }
  return chunk
    .join(' ')
    .replace(TOKEN, (t) => (path === t || path.endsWith(`/${t}`) ? ' ' : t))
    .replace(/[`*_>|:\-\s]+/g, ' ')
    .trim();
}

/** The decision. `section` is the extracted section text, or null when absent. */
export function decide({ event, deleted, section }) {
  if (event && event !== 'pull_request') {
    return { ok: true, skipped: `event is ${event}, not a pull request`, problems: [] };
  }
  if (deleted.length === 0) return { ok: true, skipped: 'no test files deleted', problems: [] };
  if (section === null) {
    return {
      ok: false,
      problems: [
        `This change deletes ${deleted.length} test file(s) but the PR body has no "## Deleted tests" section.`,
        ...deleted.map((p) => `  deleted: ${p}`),
      ],
    };
  }
  const problems = [];
  for (const path of deleted) {
    const text = entryText(section, path);
    if (text === null) problems.push(`  not named in "## Deleted tests": ${path}`);
    else if (text.length < MIN_EXPLANATION_CHARS)
      problems.push(
        `  named but not explained (say where its assertions went, or why they were dropped): ${path}`
      );
  }
  return { ok: problems.length === 0, problems };
}

const USAGE = `usage: node scripts/check-deleted-tests.mjs --base <ref> [--head <ref>] [--body-file <path>] [--event <name>]
  PR body is read from --body-file, else the PR_BODY env var. --event defaults to
  EVENT_NAME, else pull_request. --head defaults to HEAD.`;

function main(argv, env) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) return fail(USAGE, 2);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  const event = args.event ?? env.EVENT_NAME ?? 'pull_request';
  if (event !== 'pull_request') {
    console.log(`check-deleted-tests: skipped (event is ${event}).`);
    return 0;
  }
  if (!args.base) return fail(USAGE, 2);
  const raw = execFileSync(
    'git',
    ['diff', '--name-status', '-z', `-M${RENAME_THRESHOLD}%`, args.base, args.head ?? 'HEAD'],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  );
  const deleted = findDeletedTests(parseNameStatus(raw));
  const body = args['body-file'] ? readFileSync(args['body-file'], 'utf8') : (env.PR_BODY ?? '');
  const result = decide({ event, deleted, section: extractSection(body) });
  if (result.ok) {
    console.log(
      `check-deleted-tests: ok (${result.skipped ?? `${deleted.length} deleted test file(s), all accounted for`}).`
    );
    return 0;
  }
  console.error('check-deleted-tests: FAILED');
  for (const p of result.problems) console.error(p);
  console.error(
    '\nAdd a "## Deleted tests" section to the PR body with one line per deleted file: list each removed\n' +
      'it(...) and where it lives now, or "dropped on purpose: <reason>". Moves and <name>.part-N splits\n' +
      'need no entry.'
  );
  return 1;
}

function fail(msg, code) {
  console.error(msg);
  return code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), process.env);
}
