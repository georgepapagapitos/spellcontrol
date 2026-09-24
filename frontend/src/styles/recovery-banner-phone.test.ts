/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The recovery banner stays until the email is confirmed and sits above the
 * scroller, so on a phone it is on every screen. Wrapped into three rows it
 * took 245 of 844px (29%) there, deck flow included. It stays and it stays
 * non-dismissible (RecoveryBanner.tsx says why); on a phone it is one row.
 */
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'modals-dialogs.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

describe('recovery banner on a phone', () => {
  it('is one row below 600px', () => {
    const block = css.match(/@media\s*\(max-width:\s*599px\)\s*\{([\s\S]*?\})\s*\}/g) ?? [];
    const phone = block.find((b) => b.includes('.recovery-banner')) ?? '';
    const banner = phone.match(/\.recovery-banner\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(banner).toMatch(/flex-wrap:\s*nowrap/);
    const text = phone.match(/\.recovery-banner-text\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(text).toMatch(/min-width:\s*0/);
  });
});
