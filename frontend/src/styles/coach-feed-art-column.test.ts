/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../components/deck/CoachFeed.css'), 'utf8');

/**
 * Coach feed table: the art thumb fills and centers in its column.
 *
 * The base `.deck-card-row-art--crop` is 52px wide and `align-self:
 * flex-start` for the stacked row. In the table grid that pinned every plain
 * thumb to the top-left of the art column, which widens to 7rem when the list
 * holds a swap pair. This pins the table-layout override that undoes both.
 */
describe('coach feed — art thumb fills and centers in the table layout', () => {
  const block = css.match(/@container \(min-width: 48rem\) \{([\s\S]*?)\n\}/);

  it('overrides the crop thumb inside the 48rem table block', () => {
    expect(block, 'no 48rem @container block').toBeTruthy();
    const rule = block![1].match(
      /\.coach-feed-rows > li > \.deck-card-row > \.deck-card-row-art--crop\s*\{([^}]*)\}/
    );
    expect(rule, 'no table-layout rule for the crop thumb').toBeTruthy();
    expect(rule![1]).toMatch(/width:\s*auto/);
    expect(rule![1]).toMatch(/justify-self:\s*stretch/);
    expect(rule![1]).toMatch(/align-self:\s*center/);
  });
});
