// Run with `node --test scripts/check-deleted-tests.test.mjs` (ci.yml does).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decide,
  extractSection,
  findDeletedTests,
  parseNameStatus,
  stripHtmlComments,
} from './check-deleted-tests.mjs';

const raw = (...rows) => rows.map((r) => r.join('\0')).join('\0') + '\0';
const deletedOf = (...rows) => findDeletedTests(parseNameStatus(raw(...rows)));

const A = 'frontend/src/pages/DeckIdeaPage.test.tsx';
const B = 'frontend/src/components/deck/IdeaStart.test.tsx';
const section = (text) => extractSection(`## Why\nx\n\n## Deleted tests\n${text}\n\n## Guard\ny\n`);

test('parses modifies, adds, deletes and renames', () => {
  const e = parseNameStatus(raw(['M', 'a.ts'], ['D', A], ['R087', 'old.test.ts', 'new.test.ts']));
  assert.deepEqual(
    e.map((x) => x.status),
    ['M', 'D', 'R']
  );
  assert.equal(e[2].from, 'old.test.ts');
  assert.equal(e[2].score, 87);
});

test('a deleted test file is a deletion; a deleted non-test file is not', () => {
  assert.deepEqual(deletedOf(['D', A], ['D', 'frontend/src/x.ts'], ['M', B]), [A]);
});

test('no deletions', () => {
  assert.deepEqual(deletedOf(['M', A], ['A', B]), []);
  assert.deepEqual(decide({ event: 'pull_request', deleted: [], section: null }).ok, true);
});

test('a rename that stays a test file is a move', () => {
  assert.deepEqual(deletedOf(['R095', 'a/x.test.ts', 'b/x.test.ts']), []);
});

test('a low-similarity rename counts as deleting the old file', () => {
  assert.deepEqual(deletedOf(['R055', 'a/x.test.ts', 'b/y.test.ts']), ['a/x.test.ts']);
});

test('a rename to a non-test name counts as a deletion', () => {
  assert.deepEqual(deletedOf(['R083', 'a/x.test.ts', 'a/x.test-matrix.ts']), ['a/x.test.ts']);
});

test('part-split: original removed, sibling .part-N files added', () => {
  assert.deepEqual(
    deletedOf(
      ['R083', 'a/x.settings.test.ts', 'a/x.settings.test-matrix.ts'],
      ['A', 'a/x.settings.part-1.test.ts'],
      ['A', 'a/x.settings.part-2.test.ts']
    ),
    []
  );
  assert.deepEqual(deletedOf(['D', 'a/x.test.tsx'], ['A', 'a/x.part-1.test.tsx']), []);
});

test('part files in another directory or for another name do not excuse a deletion', () => {
  assert.deepEqual(deletedOf(['D', 'a/x.test.ts'], ['A', 'b/x.part-1.test.ts']), ['a/x.test.ts']);
  assert.deepEqual(deletedOf(['D', 'a/x.test.ts'], ['A', 'a/xy.part-1.test.ts']), ['a/x.test.ts']);
});

test('deleted file with no section fails', () => {
  const r = decide({
    event: 'pull_request',
    deleted: [A],
    section: extractSection('## Why\nbecause'),
  });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /no "## Deleted tests" section/);
});

test('an empty body (null from a bot PR) with a deletion fails, without throwing', () => {
  assert.equal(
    decide({ event: 'pull_request', deleted: [A], section: extractSection(null) }).ok,
    false
  );
});

test('section that misses one file fails and names it', () => {
  const s = section(
    `- \`DeckIdeaPage.test.tsx\`: its it() blocks live in DeckIdeaRedirect.test.tsx`
  );
  const r = decide({ event: 'pull_request', deleted: [A, B], section: s });
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /IdeaStart\.test\.tsx/);
});

test('every file named with a reason passes (basename or full path)', () => {
  const s = section(
    `- DeckIdeaPage.test.tsx: both it() blocks moved to DeckIdeaRedirect.test.tsx\n- ${B}: dropped on purpose, the tiles it covered are gone`
  );
  assert.equal(decide({ event: 'pull_request', deleted: [A, B], section: s }).ok, true);
});

test('a name with no explanation fails; a nested explanation passes', () => {
  assert.equal(
    decide({ event: 'pull_request', deleted: [A], section: section(`- ${A}`) }).ok,
    false
  );
  const nested = section(`- ${A}\n  - dropped on purpose: the page no longer exists`);
  assert.equal(decide({ event: 'pull_request', deleted: [A], section: nested }).ok, true);
});

test('a longer basename does not satisfy a shorter one', () => {
  const s = section('- useIdeaStart.test.tsx: moved into the finder tests');
  assert.equal(decide({ event: 'pull_request', deleted: [B], section: s }).ok, false);
});

test('headings inside code fences and HTML comments are ignored', () => {
  assert.equal(extractSection('```\n## Deleted tests\n```'), null);
  assert.equal(extractSection('<!--\n## Deleted tests\n-->'), null);
});

test('heading match is case-insensitive and ends at the next heading', () => {
  const s = extractSection(
    '## deleted TESTS\n- a.test.ts: moved to b.test.ts\n## Guard\nc.test.ts'
  );
  assert.match(s, /a\.test\.ts/);
  assert.doesNotMatch(s, /c\.test\.ts/);
});

test('non-PR events pass cleanly even with deletions and no section', () => {
  for (const event of ['push', 'merge_group', 'schedule']) {
    const r = decide({ event, deleted: [A], section: null });
    assert.equal(r.ok, true);
    assert.match(r.skipped, new RegExp(event));
  }
});

test('a destination test file named in the entry counts as the explanation', () => {
  const s = section('- DeckIdeaPage.test.tsx: moved to DeckIdeaRedirect.test.tsx');
  assert.equal(decide({ event: 'pull_request', deleted: [A], section: s }).ok, true);
});

test('.test.mjs files count as tests; test-matrix helpers and snapshots do not', () => {
  assert.deepEqual(deletedOf(['D', 'scripts/x.test.mjs']), ['scripts/x.test.mjs']);
  assert.deepEqual(
    deletedOf(['D', 'a/x.test-matrix.ts'], ['D', 'a/__snapshots__/x.test.ts.snap']),
    []
  );
  assert.deepEqual(deletedOf(['D', 'a/x.test.mjs'], ['A', 'a/x.part-1.test.mjs']), []);
});

test('stripHtmlComments removes comments and leaves no assembled residue', () => {
  assert.equal(stripHtmlComments('a<!-- x -->b'), 'ab');
  assert.equal(stripHtmlComments('a<!-- x --><!-- y -->b'), 'ab');
  // Removing the inner comment would assemble a new `<!--`; it must not survive.
  assert.equal(stripHtmlComments('<!<!-- x -->-- y -->z').includes('<!--'), false);
  assert.equal(stripHtmlComments('no comments'), 'no comments');
});

test('an unterminated comment hides everything after it, as GitHub renders it', () => {
  assert.equal(stripHtmlComments('keep <!-- hidden'), 'keep ');
  assert.equal(
    extractSection('## Why\nx\n<!--\n## Deleted tests\n- a.test.ts: moved to b.test.ts'),
    null
  );
});

test('two deleted files with one basename each need their full path', () => {
  const x = 'a/index.test.ts';
  const y = 'b/index.test.ts';
  const bare = section('- index.test.ts: moved into the new finder tests');
  const r = decide({ event: 'pull_request', deleted: [x, y], section: bare });
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 2);
  assert.match(r.problems[0], /full path/);
  const full = section(
    `- ${x}: moved into the finder tests\n- ${y}: dropped on purpose, page removed`
  );
  assert.equal(decide({ event: 'pull_request', deleted: [x, y], section: full }).ok, true);
  const one = section(
    `- ${x}: moved into the finder tests\n- index.test.ts: dropped on purpose, page removed`
  );
  assert.equal(decide({ event: 'pull_request', deleted: [x, y], section: one }).ok, false);
});

test('a file mentioned inside another entry explanation is not accounted for', () => {
  const s = section(`- ${A}: moved to IdeaStart.test.tsx and the redirect tests`);
  const r = decide({ event: 'pull_request', deleted: [A, B], section: s });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /IdeaStart\.test\.tsx/);
});

test('table rows and numbered items are entries', () => {
  const s = section(
    `| ${A} | moved to the redirect tests |\n1. ${B}: dropped on purpose, tiles removed`
  );
  assert.equal(decide({ event: 'pull_request', deleted: [A, B], section: s }).ok, true);
});

test('near-miss headings and extensionless names are rejected with a hint', () => {
  assert.equal(extractSection('### Deleted tests\n- a'), null);
  assert.equal(extractSection('## Deleted tests (1)\n- a'), null);
  const r = decide({ event: 'pull_request', deleted: [A], section: null, nearMiss: true });
  assert.match(r.problems.join('\n'), /not exactly "## Deleted tests"/);
  const noExt = section('- DeckIdeaPage.test: moved to the redirect tests');
  const r2 = decide({ event: 'pull_request', deleted: [A], section: noExt });
  assert.equal(r2.ok, false);
  assert.match(r2.problems[0], /file name/);
});
