/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeDisplayRect } from '@/lib/scanner/display-rect';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'admin-scanner.css'), 'utf8');

/**
 * The scanner crops each capture by mapping on-screen rects back into video
 * pixels through `computeDisplayRect`. If the CSS fit and that math disagree,
 * the crop sent to the matcher is not what the user framed.
 *
 * The fit is `contain` on purpose, like a phone's camera app: the whole 4:3
 * frame at full width, with black bars above and below. `cover` shipped
 * briefly (#2281) and filled the screen by cropping a third of the width off;
 * on a phone that read as "very zoomed in", and a card near the edge fell off
 * screen.
 */
describe('scanner preview fit', () => {
  it('shows the whole camera frame with a contain-fit video', () => {
    const rule = css.match(/\.scanner-video\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/object-fit:\s*contain/);
  });

  it('maps capture rects with contain math', () => {
    // A 4:3 landscape frame in a tall phone viewport: contain fills the width
    // and letterboxes top and bottom. Cover would fill the height instead and
    // run the frame off both sides.
    expect(computeDisplayRect(1280, 960, 390, 844)).toEqual({
      dispX: 0,
      dispY: (844 - 292.5) / 2,
      dispW: 390,
      dispH: 292.5,
    });
    // A frame narrower than its container fills the height, bars at the sides.
    expect(computeDisplayRect(960, 1280, 1200, 800)).toEqual({
      dispX: (1200 - 600) / 2,
      dispY: 0,
      dispW: 600,
      dispH: 800,
    });
  });
});
