/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// T135 step 3 (STYLE_GUIDE § Layout system): a hub's tab strip sits directly
// UNDER the page header (title → meta → actions → tabs), on every hub. Before
// this the Collection hub put it above the title (a layout route rendered it
// over the <Outlet/>), Decks and Social rendered it before the page root, and
// Play put its tabs beside the title on tablet. Detail pages (a binder, a
// list, a set) carry no hub strip: their back link goes up a level and the
// main nav names the hub.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(srcRoot, rel), 'utf8');

const HUB_PAGES: Array<[string, string]> = [
  ['pages/CollectionPage.tsx', 'CollectionHubTabs'],
  ['pages/BindersIndexPage.tsx', 'CollectionHubTabs'],
  ['pages/ListsPage.tsx', 'CollectionHubTabs'],
  ['pages/CollectionCombosPage.tsx', 'CollectionHubTabs'],
  ['pages/SetsPage.tsx', 'CollectionHubTabs'],
  ['pages/DecksIndexPage.tsx', 'DecksHubTabs'],
  ['pages/DiscoverDecksPage.tsx', 'DecksHubTabs'],
  ['pages/SavedDecksPage.tsx', 'DecksHubTabs'],
  ['pages/CubePage.tsx', 'DecksHubTabs'],
  ['pages/FriendsPage.tsx', 'SocialHubTabs'],
  ['pages/TradesPage.tsx', 'SocialHubTabs'],
  ['pages/PodsIndexPage.tsx', 'SocialHubTabs'],
];

describe('hub tab strips sit under the page header', () => {
  it.each(HUB_PAGES)('%s renders %s after its PageHeader, never before', (file, tabs) => {
    const src = read(file);
    const firstHeader = src.indexOf('<PageHeader');
    const firstTabs = src.indexOf(`<${tabs} />`);
    expect(firstHeader, 'no PageHeader').toBeGreaterThan(-1);
    expect(firstTabs, `no <${tabs} />`).toBeGreaterThan(firstHeader);
  });

  it('detail pages carry no hub strip', () => {
    for (const file of ['pages/BinderPage.tsx', 'components/ListEntriesView.tsx']) {
      expect(read(file), file).not.toMatch(/HubTabs|HubTabsNav/);
    }
    // SetsPage holds the index AND a set's detail page: one strip, the index's.
    expect(read('pages/SetsPage.tsx').split('<CollectionHubTabs />').length - 1).toBe(1);
  });

  it('the Collection layout route no longer renders a strip over its pages', () => {
    const code = read('components/CollectionHubLayout.tsx').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/<(HubTabsNav|CollectionHubTabs)\b/);
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
});
