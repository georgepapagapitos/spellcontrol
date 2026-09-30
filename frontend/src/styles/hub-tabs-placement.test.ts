/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// STYLE_GUIDE § Layout system → Hub pages. A hub's tab strip sits under the
// header and stays put as you move between the hub's tabs. T135 fixed the
// ORDER (the Collection strip used to sit above the title), but every page
// still built its own header and root, so the strip moved tab to tab: Cube's
// narrow column and back link, Social's 640 vs 760px caps, a meta line on
// some tabs and not others (T177). Now one component, HubPage, owns the
// title, the header row, the strip and the width, and no page renders a strip
// itself. The geometry is also measured in a real browser by the nightly
// journey (scripts/journey.mjs, "hub strip in the same place").
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(srcRoot, rel), 'utf8');
const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const HUB_PAGES: Array<[string, 'collection' | 'decks' | 'social']> = [
  ['pages/CollectionPage.tsx', 'collection'],
  ['pages/BindersIndexPage.tsx', 'collection'],
  ['pages/ListsPage.tsx', 'collection'],
  ['pages/CollectionCombosPage.tsx', 'collection'],
  ['pages/SetsPage.tsx', 'collection'],
  ['pages/DecksIndexPage.tsx', 'decks'],
  ['pages/DiscoverDecksPage.tsx', 'decks'],
  ['pages/DiscoverBrewersPage.tsx', 'decks'],
  ['pages/SavedDecksPage.tsx', 'decks'],
  ['pages/CubeIndexPage.tsx', 'decks'],
  ['pages/FriendsPage.tsx', 'social'],
  ['pages/TradesPage.tsx', 'social'],
  ['pages/PodsIndexPage.tsx', 'social'],
];

const tsxFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? tsxFiles(join(dir, e.name))
      : e.name.endsWith('.tsx') && !e.name.includes('.test.')
        ? [join(dir, e.name)]
        : []
  );

describe('hub pages', () => {
  it.each(HUB_PAGES)('%s is a HubPage of the %s hub', (file, hub) => {
    expect(read(file)).toMatch(new RegExp(`<HubPage\\s+hub="${hub}"`));
  });

  it('only HubPage renders a hub strip', () => {
    // A page that renders a strip itself also picks its own title, width and
    // header height, which is how the strip drifted.
    const offenders = tsxFiles(srcRoot)
      .filter((f) => !/(HubPage|HubTabs|HubTabsNav)\.tsx$/.test(f))
      .filter((f) =>
        /<(Collection|Decks|Social)HubTabs\b|<HubTabsNav\b/.test(
          stripComments(readFileSync(f, 'utf8'))
        )
      )
      .map((f) => f.slice(srcRoot.length + 1));
    expect(offenders).toEqual([]);
  });

  it('HubPage puts nothing between the header and the strip, and no meta line in the header', () => {
    const code = stripComments(read('components/app-shell/HubPage.tsx'));
    expect(code).toMatch(/<PageHeader[\s\S]*?compactPrimary\s*\/>\s*<Tabs \/>/);
    expect(code).not.toMatch(/<PageHeader[^>]*\bmeta=/);
  });

  it('detail pages carry no hub strip', () => {
    for (const file of ['pages/BinderPage.tsx', 'components/lists/ListEntriesView.tsx']) {
      expect(read(file), file).not.toMatch(/HubTabs|HubTabsNav|<HubPage/);
    }
  });

  it('the Collection layout route renders no strip over its pages', () => {
    const code = stripComments(read('components/collection/CollectionHubLayout.tsx'));
    expect(code).not.toMatch(/<(HubTabsNav|CollectionHubTabs|HubPage)\b/);
  });
});

describe('hub strip CSS', () => {
  const cssFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? cssFiles(join(dir, e.name))
        : e.name.endsWith('.css')
          ? [join(dir, e.name)]
          : []
    );
  const allCss = cssFiles(srcRoot).map(
    (f) => [f, readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')] as const
  );

  it('no rule relies on the strip coming BEFORE the page (the dead sibling form)', () => {
    // The strip is inside the page now, so `.collection-hub-tabs ~ *` matches
    // nothing; sticky rows key on `.app-main:has(.collection-hub-tabs)`.
    const offenders = allCss
      .filter(([, css]) => /\.collection-hub-tabs\s*~/.test(css))
      .map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  it('every flex host of a strip declares its gap as --host-gap, so the strip can cancel it', () => {
    // Without it the host's gap stacks on the strip's own margins and the
    // header → tabs distance differs hub to hub (it measured 6 to 30px).
    for (const [file, selector] of [
      ['styles/deck-builder-decks-index.css', '.decks-index-page'],
      ['styles/deck-builder-binders-index.css', '.binders-index-page'],
      ['pages/SetsPage.css', '.sets-page'],
      ['pages/TradesPage.css', '.trades-page'],
      ['pages/PodsIndexPage.css', '.pods-index-page'],
    ]) {
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
      const block = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
      expect(block, `${selector} in ${file}`).toMatch(/--host-gap:/);
      expect(block, `${selector} in ${file}`).toMatch(/gap:\s*var\(--host-gap\)/);
    }
    const nav = read('styles/responsive-nav.css');
    expect(nav).toMatch(/\.page-header \+ \.collection-hub-tabs\s*\{[^}]*--host-gap/);
  });

  it("a hub page's own root class never sets its width or outer spacing", () => {
    // HubPage owns those (.hub-page, binder-hero.css). A page class with its
    // own cap or padding is exactly how Cube and the Social tabs drifted.
    const roots = [
      'decks-index-page',
      'binders-index-page',
      'sets-page',
      'trades-page',
      'pods-index-page',
    ];
    for (const [file, css] of allCss) {
      for (const root of roots) {
        for (const m of css.matchAll(new RegExp(`\\.${root}\\s*\\{([^}]*)\\}`, 'g'))) {
          expect(m[1], `.${root} in ${file}`).not.toMatch(
            /(^|[;\s])(max-width|width|padding|margin|margin-inline)\s*:/
          );
        }
      }
    }
  });

  it('the hub header is one fixed-height row at every tier', () => {
    const css = read('styles/binder-hero.css').replace(/\/\*[\s\S]*?\*\//g, '');
    // height, not min-height: a row button's content-driven height would
    // otherwise grow the header on the tabs that have one.
    expect(css).toMatch(/\.hub-page > \.page-header\s*\{[^}]*[^-]height:/);
    expect(css).toMatch(/\.hub-page > \.page-header\s*\{[^}]*flex-wrap:\s*nowrap/);
  });
});
