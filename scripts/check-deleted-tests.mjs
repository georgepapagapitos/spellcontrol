#!/usr/bin/env node
// Fails a pull request that deletes a *.test.ts / .tsx / .mjs file without a
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
//
// WHAT COUNTS AS A TEST FILE
// `*.test.ts`, `*.test.tsx` and `*.test.mjs` (the frontend/scripts and scripts/
// suites are real tests too). Snapshots and `*.test-matrix.ts` helpers are not
// tests and stay out.
//
// THE BODY IS READ LIVE
// ci.yml fetches the PR body from the API when the step runs, not from the event
// payload, because a re-run reuses the original payload: an author who adds the
// section with `gh pr edit` and re-runs the job would otherwise fail on the old
// body. No `edited` trigger is needed.
//
// WHAT THE SECTION MUST LOOK LIKE
//   ## Deleted tests
//   - frontend/src/pages/DeckIdeaPage.test.tsx: its it() blocks moved to ...
// The heading is exactly `## Deleted tests` (any case; no `###`, no suffix).
// Each deleted file gets one list item (or table row) that STARTS with its file
// name including the extension, then says where its assertions went or that they
// were dropped on purpose and why. A file is accounted for only by its own entry,
// not by a mention inside another file's explanation. Where two deleted files
// share a basename, every one of them needs its full path.
//
// KNOWN LIMITS (deliberately left alone)
//   - the explanation is only checked for length (12 characters of text), so a
//     placeholder like "n/a, not needed" passes;
//   - a test file emptied, or its tests turned into it.skip, is not a deletion.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_FILE = /\.test\.(?:tsx?|mjs)$/;
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
  const m = /^(.*)\.test\.(tsx?|mjs)$/.exec(path);
  if (!m) return null;
  const escaped = posix.basename(m[1]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}\\.part-\\d+\\.test\\.${m[2]}$`);
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

/**
 * Drops `<!-- ... -->` the way GitHub hides it. An unterminated `<!--` hides
 * everything after it. Repeats until no `<!--` is left, so removing one comment
 * can never leave a fresh one assembled from the pieces around it.
 */
export function stripHtmlComments(text) {
  let out = text;
  for (let i = out.indexOf('<!--'); i >= 0; i = out.indexOf('<!--')) {
    const end = out.indexOf('-->', i + 4);
    out = end < 0 ? out.slice(0, i) : out.slice(0, i) + out.slice(end + 3);
  }
  return out;
}

/** Text under a `## Deleted tests` heading, up to the next heading; null if absent. */
export function extractSection(body) {
  const text = stripHtmlComments((body ?? '').replace(/\r\n?/g, '\n'));
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
const TOKEN_SRC = String.raw`[\w@.\-/]+\.test\.(?:tsx?|mjs)`;
// An entry line is a list item or table row whose FIRST token is a test file name.
const ENTRY = new RegExp(String.raw`^\s*(?:[-*+]\s+|\d+[.)]\s+|\|\s*)[\`*_\s]*(${TOKEN_SRC})`);
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;

/**
 * For one deleted path, the explanation its own entry line gives it, or null if
 * it has no entry. `needFullPath` is set when another deleted file shares its
 * basename, so a bare name cannot say which one it means.
 */
function entryText(section, path, needFullPath) {
  const lines = section.split('\n');
  const mine = (token) => path === token || (!needFullPath && path.endsWith(`/${token}`));
  const idx = lines.findIndex((l) => {
    const m = ENTRY.exec(l);
    return m !== null && mine(m[1]);
  });
  if (idx < 0) return null;
  const base = indentOf(lines[idx]);
  const chunk = [
    lines[idx].replace(ENTRY, (all, token) => all.slice(0, all.length - token.length)),
  ];
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') break;
    if (indentOf(l) <= base && LIST_ITEM.test(l)) break;
    chunk.push(l);
  }
  return chunk
    .join(' ')
    .replace(/[`*_>|:\-\s]+/g, ' ')
    .trim();
}

/** The decision. `section` is the extracted section text, or null when absent. */
export function decide({ event, deleted, section, nearMiss = false }) {
  if (event && event !== 'pull_request') {
    return { ok: true, skipped: `event is ${event}, not a pull request`, problems: [] };
  }
  if (deleted.length === 0) return { ok: true, skipped: 'no test files deleted', problems: [] };
  if (section === null) {
    return {
      ok: false,
      problems: [
        `This change deletes ${deleted.length} test file(s) but the PR body has no "## Deleted tests" section.`,
        ...(nearMiss
          ? [
              '  A heading that mentions "Deleted tests" exists but is not exactly "## Deleted tests".',
            ]
          : []),
        ...deleted.map((p) => `  deleted: ${p}`),
      ],
    };
  }
  const problems = [];
  const baseCount = new Map();
  for (const p of deleted)
    baseCount.set(posix.basename(p), (baseCount.get(posix.basename(p)) ?? 0) + 1);
  for (const path of deleted) {
    const needFull = baseCount.get(posix.basename(path)) > 1;
    const text = entryText(section, path, needFull);
    if (text === null)
      problems.push(
        needFull
          ? `  no entry starting with the full path (another deleted file shares this name): ${path}`
          : `  no entry starting with this file name: ${path}`
      );
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
  const section = extractSection(body);
  const nearMiss = section === null && /^\s*#+\s*deleted\s+tests/im.test(stripHtmlComments(body));
  const result = decide({ event, deleted, section, nearMiss });
  if (result.ok) {
    console.log(
      `check-deleted-tests: ok (${result.skipped ?? `${deleted.length} deleted test file(s), all accounted for`}).`
    );
    return 0;
  }
  console.error('check-deleted-tests: FAILED');
  for (const p of result.problems) console.error(p);
  console.error(
    '\nTo fix: edit the PR body, then re-run the failed job (the check reads the live body, no push needed).\n' +
      'The body needs:\n' +
      '  - a heading that is exactly "## Deleted tests" (two #, no suffix);\n' +
      '  - one list item per deleted file, STARTING with the full file name including its extension\n' +
      '    (DeckIdeaPage.test.tsx, not DeckIdeaPage.test), or the full path when two deleted files share a name;\n' +
      '  - after the name, each removed it(...) and where it lives now, or "dropped on purpose: <reason>".\n' +
      'Renames and <name>.part-N splits need no entry.'
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
