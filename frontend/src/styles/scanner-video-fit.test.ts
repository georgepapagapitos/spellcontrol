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
 * pixels through `computeDisplayRect`, which assumes the preview is
 * `object-fit: cover`. If the CSS fit and the math disagree, the crop sent to
 * the matcher is not what the user framed. The preview used `contain` until
 * the web scanner became the only one, and on a phone that letterboxed the
 * camera into a thin band in the middle of a black screen.
 */
describe('scanner preview fit', () => {
  it('fills the screen with a cover-fit video', () => {
    const rule = css.match(/\.scanner-video\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/object-fit:\s*cover/);
  });

  it('maps capture rects with cover math, not contain', () => {
    expect(scanner).toContain('function computeDisplayRect(');
    expect(scanner).not.toMatch(/'contain'/);
  });
});
