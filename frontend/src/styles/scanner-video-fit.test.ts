/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'admin-scanner.css'), 'utf8');
const scanner = readFileSync(join(here, '..', 'components', 'CardScanner.tsx'), 'utf8');

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
    // Contain fills the width when the video is relatively wider than the
    // container. Cover is the same function with the comparison flipped.
    const fn = scanner.match(/function computeDisplayRect\([\s\S]*?\n\}/)?.[0] ?? '';
    expect(fn).toContain('if (videoAspect > containerAspect)');
  });
});
