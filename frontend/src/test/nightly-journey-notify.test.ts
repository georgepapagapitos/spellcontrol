// Guard for E1067: the nightly journey ran red for 12+ nights because nothing
// turned a red run into a tracked item. The workflow must keep a notify job
// that opens or updates one labelled issue on failure and closes it on green.
// If this fails, restore the `notify` job in .github/workflows/nightly-journey.yml
// (needs: journey, issues: write, if: always(), gh issue create/comment/close).
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
    expect(harvest).toContain("grep -E '^FAIL '");
    expect(harvest).toContain("tr -d '`@'");
    expect(harvest).toMatch(/tr -cd '\[:print:\]\\n'/);
  });
});
