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
  it('reads the failure lines from an artifact of this run, not from any log endpoint', () => {
    // The job-log REST endpoint answered the notify job with nothing while the
    // run was still in progress (#3166 said "none found in the log" for a log
    // full of FAIL lines, even after #3169 moved to it), so the journey job
    // uploads its own output and notify downloads that.
    expect(notify).toContain('gh run download');
    expect(notify).toContain('journey-output-${{ github.run_id }}');
    expect(notify).not.toMatch(/gh api "repos\/\$GH_REPO\/actions\/jobs/);
    expect(notify).not.toMatch(/gh run view --job/);
    expect(notify).not.toMatch(/gh run view "\$\{\{ github\.run_id \}\}" --log/);
  });
  it('every journey step tees into the uploaded file and still fails the job', () => {
    const journey = yml.slice(0, yml.indexOf('\n  notify:'));
    const steps = journey.split('\n').filter((l) => /^\s+run: node scripts\/journey\.mjs /.test(l));
    expect(steps.length).toBe(4);
    for (const l of steps) expect(l).toContain('2>&1 | tee -a journey-output.log');
    // `tee` ends each pipe with exit 0 unless pipefail is on; the unset step
    // shell is `bash -e` without it, so the job pins `shell: bash`.
    expect(journey).toMatch(/defaults:\s+run:\s+shell: bash\n/);
    expect(journey).toMatch(
      /name: journey-output-\$\{\{ github\.run_id \}\}\s+path: journey-output\.log/
    );
  });
  it('sanitizes the harvested FAIL lines before they reach the issue body', () => {
    // The lines carry console text from the pages under test: a backtick would
    // close the code fence and an @ would mention someone. Sanitizing happens
    // before any line is selected.
    const harvest = notify.split('\n').find((l) => l.includes('log=$(sed')) ?? '';
    expect(harvest).toContain("tr -d '`@'");
    expect(harvest).toMatch(/tr -cd '\[:print:\]\\n'/);
    expect(harvest).toContain('cut -c1-300');
  });
  it('takes the FAIL and assert lines first, then the route summary, each capped on its own', () => {
    const fails = notify.split('\n').find((l) => l.includes('fails=$({')) ?? '';
    expect(fails).toContain("grep -E '^(FAIL |assert failed on )' | awk '!seen[$0]++' | head -20");
    expect(fails).toContain("grep -E '^- [a-z0-9-]+ /' | awk '!seen[$0]++' | head -20");
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
  it('runs the workflow harvest over a hostile journey log and keeps only safe, ordered lines', () => {
    // The two harvest lines are lifted from the workflow itself and run in bash
    // with the log on stdin: no log text is ever part of a command.
    const lines = notify.split('\n');
    const harvest = lines.find((l) => l.includes('log=$(sed')) ?? '';
    const pick = lines.find((l) => l.includes('fails=$({')) ?? '';
    const script = [
      harvest.replace(/\$\(find journey-output [^)]*\)/, '/dev/stdin'),
      pick,
      'printf "%s\\n" "$fails"',
    ].join('\n');
    const long = 'x'.repeat(400);
    const input = [
      '\uFEFFRun node scripts/journey.mjs --base http://localhost:3737',
      '- phone /a: summary line',
      'assert failed on /b - `$(touch /tmp/pwned)` @everyone',
      'FAIL chrome  phone   /c overflow=0 \u001b[31mred\u001b[0m',
      `FAIL chrome  phone   /long ${long}`,
      'ok  chrome  phone   /fine',
      ...Array.from({ length: 30 }, (_, n) => `FAIL chrome  phone   /many-${n}`),
    ].join('\n');
    const out = execFileSync('bash', ['-c', script], { input, encoding: 'utf8' }).split('\n');
    expect(/[`@]/.test(out.join('\n'))).toBe(false);
    expect(out.join('\n')).not.toContain('\u001b');
    expect(out.every((l) => l.length <= 300)).toBe(true);
    const fail = out.filter((l) => /^(FAIL |assert failed on )/.test(l));
    expect(fail.length).toBe(20);
    expect(out.indexOf('- phone /a: summary line')).toBeGreaterThan(out.lastIndexOf(fail[19]));
    // log order, not locale order: the assertion line came before the FAIL spam
    expect(fail[0]).toMatch(/^assert failed on \/b/);
    expect(out.some((l) => l.startsWith('assert failed on /b'))).toBe(true);
    expect(out.join('\n')).not.toContain('ok  chrome');
  });
});
