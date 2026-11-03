/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../playtest/components/OpeningHandSheet.css'), 'utf8');

/**
 * DK-01: the opening-hand takeover paints over `var(--bg)`, which is light in
 * the light scheme. `--brand-seal-gold` (#f0c368) is a dark-surface color and
 * was nearly invisible there. `--warn-text` is scheme-aware (dark-brown on
 * light, pale gold on dark).
 */
describe('opening hand readout color', () => {
  it('never uses the dark-surface seal gold for the stats or status line', () => {
    const bodies = [...css.matchAll(/[^}]*playtest-opening-(?:stats|status)[^{]*\{([^}]*)\}/g)].map(
      (m) => m[1]
    );
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) expect(b).not.toMatch(/brand-seal-gold/);
  });

  it('the takeover readout takes the scheme-aware warn token', () => {
    const m = css.match(
      /\.is-takeover \.playtest-opening-stats,\s*\.is-takeover \.playtest-opening-status \{([^}]*)\}/
    );
    expect(m?.[1]).toMatch(/color:\s*var\(--warn-text\)/);
  });
});
