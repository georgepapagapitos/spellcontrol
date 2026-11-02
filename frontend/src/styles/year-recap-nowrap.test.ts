/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../components/play/YearRecap.css'),
  'utf8'
);

/**
 * A W–L record in the year recap's table wrapped at its en dash on a phone
 * ("4–" over "3"), found in a real-browser pass, 2026-11-02.
 */
describe('year recap table cells', () => {
  it('the record and rate cells never break', () => {
    expect(css).toMatch(/\.year-recap-nowrap\s*\{[^}]*white-space:\s*nowrap/);
  });
});
