// Guard for E1067: the nightly journey ran red for 12+ nights because nothing
// turned a red run into a tracked item. The workflow must keep a notify job
// that opens or updates one labelled issue on failure and closes it on green.
// If this fails, restore the `notify` job in .github/workflows/nightly-journey.yml
// (needs: journey, issues: write, if: always(), gh issue create/comment/close).
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const yml = readFileSync(
  resolve(__dirname, '../../../.github/workflows/nightly-journey.yml'),
  'utf8'
);
const notify = yml.slice(yml.indexOf('\n  notify:'));

describe('nightly journey failure tracking', () => {
  it('has a notify job that runs after the journey even when it fails', () => {
    expect(yml).toContain('\n  notify:');
    expect(notify).toMatch(/needs:\s*journey/);
    expect(notify).toMatch(/if:.*always\(\)/);
  });
  it('can write issues, scoped to that job only', () => {
    expect(notify).toMatch(/issues:\s*write/);
    expect(yml.slice(0, yml.indexOf('\n  notify:'))).not.toMatch(/issues:\s*write/);
  });
  it('opens or comments on one labelled issue and closes it on green', () => {
    expect(notify).toContain('gh issue create');
    expect(notify).toContain('gh issue comment');
    expect(notify).toContain('gh issue close');
    expect(notify).toContain('--label "$LABEL"');
  });
  it('reads the finished journey job log, not the in-progress run log', () => {
    expect(notify).toMatch(/gh run view --job "\$jid" --log/);
    expect(notify).not.toMatch(/gh run view "\$\{\{ github\.run_id \}\}" --log/);
  });
  it('sanitizes the harvested FAIL lines before they reach the issue body', () => {
    // The lines carry console text from the pages under test: a backtick would
    // close the code fence and an @ would mention someone.
    const harvest = notify.split('\n').find((l) => l.includes('fails=$(gh run view')) ?? '';
    expect(harvest).toContain("grep -E '^(FAIL |assert failed on |- [a-z0-9-]+ /)'");
    expect(harvest).toContain("tr -d '`@'");
    expect(harvest).toMatch(/tr -cd '\[:print:\]\\n'/);
  });
  it('harvests every line shape a failed run prints, not only FAIL lines', () => {
    // #3166 read "none found in the log" for a run whose log held an
    // `assert failed on ...` line and a `- phone /route: ...` summary line.
    // Run the real harvest filter over the log as the job sees it: tab-separated
    // job, step and timestamped text, the timestamp then stripped by the sed.
    const harvest = notify.split('\n').find((l) => l.includes('fails=$(gh run view')) ?? '';
    const filter = /\|\s*(grep -E '[^']*')\s*\|/.exec(harvest)?.[1] ?? '';
    expect(filter).not.toBe('');
    const stamp = '2026-11-02T17:57:09.6100246Z';
    const log = [
      `j\ts\t${stamp} FAIL chrome  phone   /decks/{deck} (card preview)  overflow=0`,
      `j\ts\t${stamp}         assert failed on /decks/{deck} (card preview) — card preview opens from a deck row: expected ".card-preview-panel", got null`,
      `j\ts\t${stamp}   - phone /decks/{deck} (card preview): assert failed on /decks/{deck} (card preview) — x`,
      `j\ts\t${stamp} chrome: 188 screens, 1 failed`,
      `j\ts\t${stamp} - not a failure line`,
      `j\ts\t${stamp} Run node scripts/journey.mjs --base http://localhost:3737`,
    ].join('\n');
    const out = execSync(`cut -f3- | sed -E 's/^[0-9TZ:.-]+[[:space:]]+//' | ${filter} | sort -u`, {
      input: log,
      encoding: 'utf8',
    })
      .trim()
      .split('\n');
    expect(out).toHaveLength(3);
    expect(out.some((l) => l.startsWith('FAIL chrome'))).toBe(true);
    expect(out.some((l) => l.startsWith('assert failed on /decks'))).toBe(true);
    expect(out.some((l) => l.startsWith('- phone /decks'))).toBe(true);
  });
});
