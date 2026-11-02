// The deck editor's first paint must not wait on materializing every binder.
// The binder badge on a row and the add-cards binder chip need that map; the
// deck itself does not. On a ~10k-card collection the pass was about a second
// of the phone main thread (4x CPU) ahead of the deck's LCP element: 4.6 to
// 5.4 s before, 2.6 to 3.4 s after it moved to an idle callback (E1049, O16).
// Fix: take the map from `useBinderByCopyIdAfterPaint`, not `useBinderByCopyId`.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SRC } from './import-graph';

describe('deck editor first paint', () => {
  const source = readFileSync(join(SRC, 'pages/deck-editor/use-deck-ownership.ts'), 'utf8');

  it('fills the binder map after paint', () => {
    expect(source).toMatch(/useBinderByCopyIdAfterPaint\(\)/);
  });

  it('does not materialize every binder during render', () => {
    expect(source).not.toMatch(/\buseBinderByCopyId\b/);
  });
});
