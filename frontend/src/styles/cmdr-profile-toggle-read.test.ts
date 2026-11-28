/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Generator step 1's "What <commander> wants" toggle shows its archetype read while closed
 * (E1115). The read is one word of at most 12 characters ("Spellslinger"); the title is the
 * commander's name and can run long ("What Hakbal of the Surging Soul wants"). With both
 * spans shrinkable and the read at `min-width: 0`, a wrapping title squeezed the read to
 * "T…" at 320px and 390px. The read never shrinks, the title takes the slack and wraps, and
 * the toggle keeps the kit Disclosure's 44px touch floor.
 */

const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, 'deck-builder-commander-profile.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
);
const tsx = readFileSync(join(dir, '../components/deck/CommanderProfileCard.tsx'), 'utf8');

const rules = [...css.matchAll(/([^{}@;]+?)\s*\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1].trim(),
  body: m[2],
}));
const body = (selector: string) => rules.find((r) => r.selector === selector)?.body ?? '';

describe('commander breakdown toggle', () => {
  it('the closed read never shrinks', () => {
    const read = body('.cmdr-profile-toggle-summary');
    expect(read, 'no .cmdr-profile-toggle-summary rule').not.toBe('');
    expect(read).toMatch(/flex-shrink:\s*0|flex:\s*none|flex:\s*0\s+0/);
    expect(read).not.toMatch(/text-overflow:\s*ellipsis/);
  });

  it('the title takes the slack and can wrap', () => {
    const title = body('.cmdr-profile-toggle-title');
    expect(title, 'no .cmdr-profile-toggle-title rule').toMatch(/flex:\s*1\s+1/);
    expect(title).toMatch(/min-width:\s*0/);
    expect(title).not.toMatch(/white-space:\s*nowrap/);
    expect(tsx).toContain('className="cmdr-profile-toggle-title"');
  });

  it('keeps a 44px touch floor', () => {
    expect(body('.cmdr-profile-toggle')).toMatch(/min-height:\s*44px/);
  });
});
