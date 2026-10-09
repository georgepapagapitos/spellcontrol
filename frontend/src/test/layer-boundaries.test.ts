// Guard: the frontend's layers only import DOWN.
//
//   pages  ->  components  ->  store / lib / deck-builder services / types
//
// WHY. A module in lib/ or store/ that imports a component drags React UI
// (and its CSS chunk) into code that tests, workers and the backend-shared
// logic expect to be plain functions, and it is how a "utility" quietly grows
// a dependency on one screen. It is also the first step of most import cycles
// (import-cycles.test.ts), which this guard catches earlier and names by
// layer. components/shared/ holds the primitives every surface uses, so it
// may not reach into one feature's folder either.
//
// Three rules, over every import, type-only ones included (a type-only edge is
// erased at build time, but it still makes lib/ depend on a screen's file for
// its shape, and the type belongs in the lower layer; E548 moved the last nine):
//   1. non-UI code (lib, store, types, the deck-builder's services/lib/store/
//      types, playtest/lib) imports nothing from a UI folder (components,
//      pages, deck-builder/components, playtest/components).
//   2. no UI folder imports from pages/.
//   3. components/shared/ imports no feature folder: no components/<x>/ other
//      than shared/ and overlays/ (Modal, SelectMenu, OverflowMenu, Tabs: the
//      overlay primitives), and neither deck-builder/components nor
//      playtest/components.
//
// FIXING A FAILURE. Move the thing being imported DOWN: a helper a component
// and a lib module both need goes in lib/; a hook that renders UI belongs in
// components/, not lib/. There is no allowlist: the count reached zero with
// the lib/ regroup (board T176), so keep it zero.
//
// A fourth rule keeps lib/ navigable: every module lives in a domain folder
// (lib/deck/, lib/binder/, lib/util/, ...), none at the top level. ARCHITECTURE.md
// lists the folders; a module that fits none of them is a new folder's first
// file, named after the product area it serves.
//
// A fifth does the same for components/: a component lives in its area's
// folder (collection/, binder/, card/, app-shell/, ...). The root holds only
// ROOT_COMPONENTS, the display pieces components/shared/ itself renders. Each
// belongs in shared/ once it has a /dev/catalog specimen (catalog-coverage
// requires one), so the list only shrinks.

import { describe, it, expect } from 'vitest';
import { relative, sep } from 'node:path';
import { SRC, sourceFiles, valueImports } from './import-graph';

const rel = (f: string) => relative(SRC, f).split(sep).join('/');

const UI = ['components/', 'pages/', 'deck-builder/components/', 'playtest/components/'];
const NON_UI = [
  'lib/',
  'store/',
  'types/',
  'deck-builder/services/',
  'deck-builder/lib/',
  'deck-builder/store/',
  'deck-builder/types/',
  'playtest/lib/',
];
const under = (path: string, dirs: string[]) => dirs.some((d) => path.startsWith(d));

/** The rule an edge breaks, or null. */
function brokenRule(from: string, to: string): string | null {
  if (under(from, NON_UI) && under(to, UI)) return 'non-UI code imports UI';
  if (under(from, UI) && to.startsWith('pages/') && !from.startsWith('pages/')) {
    return 'UI imports a page';
  }
  if (from.startsWith('components/shared/')) {
    const feature =
      (to.startsWith('components/') &&
        /^components\/[^/]+\//.test(to) &&
        !to.startsWith('components/shared/') &&
        !to.startsWith('components/overlays/')) ||
      to.startsWith('deck-builder/components/') ||
      to.startsWith('playtest/components/');
    if (feature) return 'a shared primitive imports a feature folder';
  }
  return null;
}

// The components/ root: what components/shared/ renders and has not yet
// absorbed. Shrink only.
const ROOT_COMPONENTS = new Set([
  'components/BinderBadge.tsx',
  'components/DeckBadge.tsx',
  'components/FoilBadge.tsx',
  'components/Legend.tsx',
  'components/ManaCost.tsx',
  'components/SortDirArrow.tsx',
  'components/ViewModeToggle.tsx',
  'components/ZoomControl.tsx',
]);

describe('layer boundaries', () => {
  const files = sourceFiles();
  const edges = files.flatMap((f) => valueImports(f, true).map((t) => [rel(f), rel(t)] as const));
  const broken = edges
    .map(([from, to]) => ({ edge: `${from} -> ${to}`, rule: brokenRule(from, to) }))
    .filter((e): e is { edge: string; rule: string } => e.rule !== null);

  it('walks the real source tree', () => {
    // Guards the guard: a broken walk would pass vacuously.
    expect(files.length).toBeGreaterThan(500);
    expect(edges.length).toBeGreaterThan(2000);
  });

  it('has no upward import', () => {
    expect(
      broken.map((b) => `  ${b.edge}   (${b.rule})`),
      'An import points UP a layer. Move the shared piece down (see the header of ' +
        'src/test/layer-boundaries.test.ts).'
    ).toEqual([]);
  });

  it('keeps every lib/ module in a domain folder', () => {
    const loose = files.map(rel).filter((f) => /^lib\/[^/]+$/.test(f));
    expect(
      loose,
      'A module sits at the top of lib/. Put it in the domain folder it serves ' +
        '(ARCHITECTURE.md lists them), or start a new one.'
    ).toEqual([]);
  });

  it('keeps every component in an area folder', () => {
    const inRoot = files.map(rel).filter((f) => /^components\/[^/]+$/.test(f));
    expect(
      inRoot.filter((f) => !ROOT_COMPONENTS.has(f)),
      'A component sits at the top of components/. Put it in the area folder it ' +
        'serves (ARCHITECTURE.md lists them).'
    ).toEqual([]);
    expect(
      [...ROOT_COMPONENTS].filter((f) => !inRoot.includes(f)),
      'These left the components/ root. Delete them from ROOT_COMPONENTS.'
    ).toEqual([]);
  });
});

describe('brokenRule', () => {
  it('classifies each rule and leaves downward edges alone', () => {
    expect(brokenRule('lib/a.ts', 'components/B.tsx')).toBe('non-UI code imports UI');
    expect(brokenRule('deck-builder/services/x.ts', 'deck-builder/components/Y.tsx')).toBe(
      'non-UI code imports UI'
    );
    expect(brokenRule('components/A.tsx', 'pages/HomePage.tsx')).toBe('UI imports a page');
    expect(brokenRule('components/shared/A.tsx', 'components/deck/B.tsx')).toBe(
      'a shared primitive imports a feature folder'
    );
    expect(brokenRule('components/shared/A.tsx', 'components/overlays/Modal.tsx')).toBeNull();
    expect(brokenRule('pages/A.tsx', 'pages/cube/B.tsx')).toBeNull();
    expect(brokenRule('components/A.tsx', 'lib/b.ts')).toBeNull();
    expect(brokenRule('pages/A.tsx', 'components/B.tsx')).toBeNull();
  });
});
