/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'shared.css'), 'utf8');

/**
 * The share dialog's link row is an address input beside Copy and Share….
 * An `<input>` has an intrinsic width (~20ch) that `flex: 1` alone does not
 * let it shrink below, so on a 390px sheet the row ran past the edge and
 * clipped the Share… button (seen in a headless-Edge shot while reworking the
 * dialog for board T136). jsdom doesn't lay anything out, so reading the
 * stylesheet is what's left: the address must be allowed to give way, and
 * the buttons must not.
 */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  return m ? m[2] : '';
}

describe('share dialog link row', () => {
  it('lets the address shrink', () => {
    expect(rule('.share-dialog-url')).toMatch(/min-width:\s*0/);
  });

  it('never shrinks the buttons beside it', () => {
    expect(rule('.share-dialog-link > .btn')).toMatch(/flex-shrink:\s*0/);
  });
});
