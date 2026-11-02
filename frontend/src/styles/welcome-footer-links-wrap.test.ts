/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The welcome footer's site links are a flex row. Seven links do not fit one
// line at 390px: without wrapping the row overflowed the page on both sides
// and clipped "Organize a binder" and "Terms" (found adding the /bracket link).
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../pages/WelcomePage.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

describe('welcome footer links', () => {
  it('wrap instead of overflowing a phone width', () => {
    const at = css.indexOf('.welcome-footer-links {');
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at, css.indexOf('}', at))).toMatch(/flex-wrap:\s*wrap/);
  });
});
