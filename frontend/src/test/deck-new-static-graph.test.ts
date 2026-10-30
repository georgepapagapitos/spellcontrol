// /decks/new paints only after every module in its static import graph has
// loaded. Its Import and Product dialogs open on a tap, and between them they
// pull in about fifty modules; imported statically they held a cold visit's
// LCP past 3 s on 4G, the 24 poor samples of 60 in production (E1049).
// Fix: load a tap-only dialog with `lazy(() => import(...))`, not a static import.

import { describe, expect, it } from 'vitest';
import { join, relative } from 'node:path';
import { SRC, valueImports } from './import-graph';

function staticGraph(entry: string): Set<string> {
  const seen = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length) {
    for (const next of valueImports(queue.pop()!)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

describe('/decks/new static import graph', () => {
  const graph = [...staticGraph(join(SRC, 'pages/DeckNewPage.tsx'))].map((f) => relative(SRC, f));

  it.each(['components/deck/ImportDeckDialog.tsx', 'components/import/ProductSearchDialog.tsx'])(
    'does not statically reach %s',
    (dialog) => {
      expect(graph).not.toContain(dialog);
    }
  );
});
