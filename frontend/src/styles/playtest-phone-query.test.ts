/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PHONE_QUERY, SHORT_LANDSCAPE_QUERY } from '@/playtest/hooks/use-narrow-viewport';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'playtest.css'), 'utf8');

/**
 * The board asks "is this a phone?" in two places: PlaytestBoard (which piles
 * to mount, via PHONE_QUERY) and playtest.css (the tab, the pile span). They
 * drifted once already in spirit: both said `max-width: 767px`, which is only
 * an upright phone, so a phone on its side got the tablet table in both. Now
 * the question is "narrow, or on its side", and this pins the stylesheet to
 * the very strings the component uses, so the two cannot disagree.
 */
describe('playtest phone query', () => {
  it('the phone block uses PHONE_QUERY', () => {
    expect(css).toContain(`@media ${PHONE_QUERY} {`);
  });

  it('the short-landscape tier uses SHORT_LANDSCAPE_QUERY, and nothing still says 420', () => {
    expect(css).toContain(`@media ${SHORT_LANDSCAPE_QUERY} {`);
    expect(css).not.toContain('max-height: 420px');
  });

  it('the name-chip hand strip is gone for good', () => {
    // The fan is the hand at every size; a strip of card names under the
    // table was the short-landscape tier's old stand-in.
    expect(css).not.toContain('.playtest-hand-drawer');
  });
});
