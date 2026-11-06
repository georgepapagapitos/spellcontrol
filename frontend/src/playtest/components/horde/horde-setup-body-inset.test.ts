// @vitest-environment node
/**
 * Guard: the Fight a horde sheet's body keeps a top inset under the header.
 *
 * The body is the sheet's scroll region and sits directly under
 * `.card-picker-header`, whose bottom border is the divider. With a 0 top
 * padding the tile grid, and the selected tile's outline, ran flush into that
 * divider at every width.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'HordeSetupSheet.css'),
  'utf8'
);

describe('Fight a horde sheet body', () => {
  it('has a non-zero top padding under the header divider', () => {
    const rule = css.match(/\.horde-setup-sheet__body\s*\{([^}]*)\}/)?.[1] ?? '';
    const padding = rule.match(/(?:^|\n)\s*padding:\s*([^;]+);/)?.[1]?.trim() ?? '';
    const top = rule.match(/padding-top:\s*([^;]+);/)?.[1]?.trim() ?? padding.split(/\s+/)[0];
    expect(top, 'Give .horde-setup-sheet__body a top inset (var(--space-3))').toBeTruthy();
    expect(top).not.toBe('0');
  });
});
