// Guard for E1067: the nightly journey ran red for 12+ nights because nothing
// turned a red run into a tracked item. The workflow must keep a notify job
// that opens or updates one labelled issue on failure and closes it on green.
// If this fails, restore the `notify` job in .github/workflows/nightly-journey.yml
// (needs: journey, issues: write, if: always(), gh issue create/comment/close).
import { execFileSync } from 'node:child_process';
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
    expect(notify).toContain('gh api "repos/$GH_REPO/actions/jobs/$jid/logs"');
    expect(notify).not.toMatch(/gh run view --job/);
    expect(notify).not.toMatch(/gh run view "\$\{\{ github\.run_id \}\}" --log/);
  });
  it('sanitizes the harvested FAIL lines before they reach the issue body', () => {
    // The lines carry console text from the pages under test: a backtick would
    // close the code fence and an @ would mention someone. Sanitizing happens
    // before any line is selected.
    const harvest = notify.split('\n').find((l) => l.includes('log=$(gh api')) ?? '';
    expect(harvest).toContain("tr -d '`@'");
    expect(harvest).toMatch(/tr -cd '\[:print:\]\\n'/);
    expect(harvest).toContain('cut -c1-300');
  });
  it('takes the FAIL and assert lines first, then the route summary, each capped on its own', () => {
    const fails = notify.split('\n').find((l) => l.includes('fails=$({')) ?? '';
    expect(fails).toContain("grep -E '^(FAIL |assert failed on )' | sort -u | head -20");
    expect(fails).toContain("grep -E '^- [a-z0-9-]+ /' | sort -u | head -20");
    expect(fails.indexOf('assert failed on')).toBeLessThan(fails.indexOf('- [a-z0-9-]+ /'));
    expect(fails).not.toContain('head -40');
  });
  it('the harvest patterns keep every line shape a failed run prints', () => {
    // #3166 read "none found in the log" for a run whose log held an
    // `assert failed on ...` line and a `- phone /route: ...` summary line.
    // The patterns are asserted as literals above; run them with no shell over
    // a log as the job sees it after the timestamp strip.
    const log = [
      'FAIL chrome  phone   /decks/{deck} (card preview)  overflow=0',
      'assert failed on /decks/{deck} (card preview) - card preview opens from a deck row',
      '- phone /decks/{deck} (card preview): assert failed on /decks/{deck} (card preview) - x',
      'chrome: 188 screens, 1 failed',
      '- not a failure line',
      'Run node scripts/journey.mjs --base http://localhost:3737',
    ].join('\n');
    const pick = (pattern: string) =>
      execFileSync('grep', ['-E', pattern], { input: log, encoding: 'utf8' }).trim().split('\n');
    const first = pick('^(FAIL |assert failed on )');
    expect(first).toHaveLength(2);
    expect(first[0]).toMatch(/^FAIL chrome/);
    expect(first[1]).toMatch(/^assert failed on \/decks/);
    expect(pick('^- [a-z0-9-]+ /')).toEqual([
      '- phone /decks/{deck} (card preview): assert failed on /decks/{deck} (card preview) - x',
    ]);
  });
});
