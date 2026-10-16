/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The style guide contradicted itself in four places (UI-tells audit,
// 2026-10-15), and a contradiction in the guide is how a wrong rule gets
// re-implemented: the reader picks whichever sentence they found first.
//   - The US-spelling rule's banned list had been rewritten into the US words
//     ("never color, flavor…").
//   - The confirm-dialog example used "This cannot be undone." against the
//     canonical "This can't be undone." (Voice & copy rule 14).
//   - § Device tiers said "Use 600, not 599" against the guarded tier-edge
//     rule (599 / 1023, styles/tier-edge-queries.test.ts).
//   - radius-tokens.test.ts named 8px / 12px while tokens.css says 6px / 10px.
// The guide also names the shared directive it sits on (ui-tells.md).
const frontend = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const guide = readFileSync(join(frontend, 'STYLE_GUIDE.md'), 'utf8');
const tokens = readFileSync(join(frontend, 'src', 'styles', 'tokens.css'), 'utf8');
const radiusTest = readFileSync(join(frontend, 'src', 'styles', 'radius-tokens.test.ts'), 'utf8');

describe('STYLE_GUIDE consistency', () => {
  it('names the shared ui-tells directive as its floor', () => {
    expect(guide).toMatch(/plugins\/polish\/reference\/ui-tells\.md/);
  });

  it('bans the UK spellings by name, not the US ones', () => {
    const rule = guide.slice(
      guide.indexOf('**US English spelling'),
      guide.indexOf('**US English spelling') + 600
    );
    for (const uk of ['colour', 'flavour', 'favourite', 'grey', 'organise', 'centre']) {
      expect(rule).toContain(`\`${uk}\``);
    }
    expect(rule).not.toMatch(/never color, flavor/);
  });

  it('only ever writes the canonical finality clause', () => {
    expect(guide).not.toMatch(/This cannot be undone\./);
  });

  it('agrees with the guarded tier edges', () => {
    expect(guide).not.toMatch(/Use \*\*600\*\*, not 599/);
    expect(guide).toMatch(/`max-width: 599px` \(mobile\)/);
  });

  it("radius-tokens.test.ts names the tokens' real values", () => {
    const px = (name: string) => tokens.match(new RegExp(`${name}:\\s*(\\d+)px`))?.[1];
    expect(radiusTest).toContain(`\`--radius\` (${px('--radius')}px`);
    expect(radiusTest).toContain(`\`--radius-lg\` (${px('--radius-lg')}px`);
  });
});
