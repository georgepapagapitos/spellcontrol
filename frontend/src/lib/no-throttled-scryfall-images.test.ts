import { describe, expect, it } from 'vitest';

/**
 * Guard: nothing may build a card-image `<img src>` against the rate-limited
 * Scryfall **API** host (`api.scryfall.com/cards/…?format=image`). That endpoint
 * is throttled (~10 req/s) regardless of `format`, so a panel that mounts dozens
 * of name-only rows at once bursts straight into HTTP 429. Resolve the card and
 * render its `image_uris` (the un-throttled `cards.scryfall.io` CDN) via
 * `useCardThumb` in `src/lib/card-thumbs.ts` instead.
 *
 * This pattern was copy-pasted into 9 components before anything stopped it —
 * this test is that stop.
 */

// The trap, on a single line (string or template-literal form).
const FORBIDDEN = /api\.scryfall\.com\/cards[^\n]*format=image/;
// card-thumbs.ts documents the trap in prose; everything else must be clean.
const ALLOWED = /card-thumbs\.ts$/;

// Vite-native raw import of every source file — no node fs/path, so this stays
// typecheckable under the frontend's browser-oriented tsconfig.
const sources = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('no rate-limited Scryfall image URLs', () => {
  it('no source file builds an img against api.scryfall.com …format=image', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !/\.test\.tsx?$/.test(path) && !ALLOWED.test(path))
      .filter(([, content]) => FORBIDDEN.test(content))
      .map(([path]) => path);
    expect(offenders, 'Use useCardThumb (src/lib/card-thumbs.ts) instead').toEqual([]);
  });
});
