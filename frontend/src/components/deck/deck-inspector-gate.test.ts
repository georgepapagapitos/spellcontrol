/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Guards the deck page's desktop card preview (2026-09-25). The card inspector
// used to mount only at ≥1440px, and between 1024 and 1439 a floating
// hover-peek stood in. The deck list spans the page in that band, so the peek
// had no gutter to sit in: `computePeekPlacement` clamped it to the viewport's
// left edge, right on top of the card names, including the one being hovered.
//
// The fix is one preview surface on desktop, gated in three places that must
// agree: INSPECTOR_QUERY (JS mount), the CSS hide rule, and the hover hook's
// minViewport. If you move the breakpoint, move all three. Don't bring back a
// floating hover peek on this page; the touch long-press variant is the only one.

const dir = dirname(fileURLToPath(import.meta.url));
const display = readFileSync(join(dir, 'DeckDisplay.tsx'), 'utf8');
const css = readFileSync(join(dir, 'DeckCardInspector.css'), 'utf8');

const inspectorMin = Number(/INSPECTOR_QUERY = '\(min-width: (\d+)px\)/.exec(display)?.[1] ?? NaN);

describe('deck card inspector gate', () => {
  it('the CSS hide rule sits exactly one pixel below the JS mount query', () => {
    const cssMax = Number(
      /@media \(max-width: (\d+)px\)[^{]*\{\s*\.deck-card-inspector \{/.exec(css)?.[1] ?? NaN
    );
    expect(inspectorMin).toBeGreaterThan(0);
    expect(cssMax).toBe(inspectorMin - 1);
  });

  it('the hover hook answers only where the inspector is there to show it', () => {
    const hookMin = Number(/useDeckHoverPeek\(\{[^}]*minViewport: (\d+)/.exec(display)?.[1] ?? NaN);
    expect(hookMin).toBe(inspectorMin);
  });

  it('renders no floating hover peek, only the touch long-press one', () => {
    const peeks = display.match(/<DeckHoverPeek[\s\S]*?\/>/g) ?? [];
    expect(peeks.length).toBeGreaterThan(0);
    for (const p of peeks) expect(p).toContain('variant="touch"');
  });
});
