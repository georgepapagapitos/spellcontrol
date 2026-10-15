import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The Filters dialog is a centered dialog (`margin-block: auto`) that becomes a
// bottom sheet on a phone. Left as is, that auto margin floated the sheet 24px
// above the screen's bottom edge (measured at 390px), so the phone rule has to
// pin it: top auto, bottom 0.
describe('collection Filters dialog as a phone sheet', () => {
  const css = readFileSync(join(__dirname, 'collection.css'), 'utf8');
  const rule = css.match(
    /\.modal-backdrop\.modal-backdrop--sheet > \.collection-filters-dialog\[role='dialog'\]\s*\{[^}]*\}/
  )?.[0];

  it('has a phone sheet rule', () => {
    expect(rule).toBeTruthy();
  });

  it('sits on the bottom edge instead of floating above it', () => {
    expect(rule).toMatch(/margin-block:\s*auto 0/);
  });
});
