// @vitest-environment node
//
// Guard: badges, counts, surfaces and section headers come from the display
// primitives (board T166, the second round of the component library after
// T152). Each primitive renders the family's existing class, so moving a call
// site onto it changes no pixel; what it adds is one API per shape (`tone`,
// `corner`, `placement`, `variant`) that the convergence PRs then give one
// look. A raw class skips that API, so this counts three shapes per file and
// fails when one appears in a new file or grows in a listed one:
//
//   - rawBadge: a -badge, -pill or -tag class (or a BEM __badge), or one of
//     the count-bubble classes below, on a non-interactive raw element. On
//     card art it is `ArtBadge`; a number is `Count`; anything else is a
//     label `Chip` with a `tone`. A plain `-count` is usually text ("12
//     cards") that a screen reader must still hear, so only the bubbles are
//     listed.
//   - rawSurface: one of the surface families below on a raw element (use
//     `Surface` with its variant).
//   - rawSectionHead: a -section-head/-section-header class on a raw element
//     (use `SectionHeader`).
//
// A class on a <button>, link or form control belongs to the control guard
// (control-primitives-usage.test.ts), not this one.
//
// The migration is done (T166 W1-W5). What is left is a list of PERMANENT
// exemptions, each with the ruling that keeps it, and a test refuses any
// entry without one: a new match is fixed with the primitive, never by adding
// it here. A file that stops matching must leave the list (the stale check),
// so an exemption cannot outlive its reason.

import { describe, it, expect } from 'vitest';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parseTsx, sourceFiles, strings } from './jsx-scan';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type Shape = 'rawBadge' | 'rawSurface' | 'rawSectionHead';

const BADGE_CLASS = /^[a-z][a-z0-9-]*(-(badge|pill|tag)|__badge)(--[a-z0-9-]+)?$/;

/** Count bubbles named -count (the rest are named -badge). */
const COUNT_BUBBLES = new Set([
  'sc-tab-count',
  'home-waiting-count',
  'trades-section-count',
  'pull-list-group-count',
  'play-setup-roster-count',
  'trending-deck-count',
  'commander-result-platform-count',
]);

/** Badges on card art whose names do not end in -badge (T166 W1). */
const ART_BADGES = new Set([
  'collection-grid-qty',
  'collection-grid-set',
  'collection-grid-surplus',
  'deck-card-grid-qty',
  'deck-card-grid-alloc',
  'deck-card-grid-partner',
  'deck-card-grid-tags',
  'deck-card-grid-synergy',
  'card-group-qty',
  'product-card-qty',
  'home-deck-arrivals',
]);

/** Named -pill but a control class the control guard owns. */
const CONTROL_CLASSES = new Set(['toolbar-pill']);

/** The surface families (STYLE_GUIDE § Layout system, Surfaces). Most `-panel`
 *  and `-card` names are layout or real Magic cards, so this is a list, not a
 *  suffix. */
const SURFACE_CLASSES = new Set([
  // sleeve: an index tile
  'decks-index-card',
  'discover-tile',
  'public-profile-tile',
  'deck-library-tile',
  'binders-index-card',
  'home-card',
  'game-night-card',
  'play-home-card',
  // framed: an in-page section card
  'card-search-panel',
  'deck-combos-panel',
  'deck-test-hand-panel',
  'search-syntax-panel',
  'deck-stats-panel',
  'partner-panel',
  'settings-card',
  'auth-card',
  'import-card',
  'error-boundary-card',
  'breakdown-card',
  'deck-identity-card',
  'friend-hub-h2h-card',
  'trade-offer-card',
  'trade-accept-card',
  // popover: an anchored panel
  'filter-popover-panel',
  'sort-popover-panel',
  'toolbar-popover-panel',
  'view-popover-panel',
  'binder-color-panel',
  'rule-field-panel',
  'discover-filters-panel',
]);

const SECTION_HEAD_CLASS = /-section-head(er)?$/;

/** Interactive elements: their classes are the control guard's. */
const CONTROL_TAGS = new Set(['button', 'a', 'input', 'label', 'select', 'textarea', 'summary']);

const PRIMITIVES = new Set(
  ['ArtBadge', 'Chip', 'Count', 'SectionHeader', 'Surface'].map(
    (name) => `components/shared/${name}.tsx`
  )
);

const MIGRATED_TAGS = new Set(['ArtBadge', 'Chip', 'Count', 'Surface', 'SectionHeader']);

const matches: Record<Shape, (t: string) => boolean> = {
  rawBadge: (t) =>
    (BADGE_CLASS.test(t) && !CONTROL_CLASSES.has(t)) || COUNT_BUBBLES.has(t) || ART_BADGES.has(t),
  rawSurface: (t) => SURFACE_CLASSES.has(t),
  rawSectionHead: (t) => SECTION_HEAD_CLASS.test(t),
};

const SHAPES = Object.keys(matches) as Shape[];
const zero = (): Record<Shape, number> => ({ rawBadge: 0, rawSurface: 0, rawSectionHead: 0 });

/** Raw matches per shape, and the same classes seen on a primitive (`migrated`). */
function count(file: string): { raw: Record<Shape, number>; migrated: Record<Shape, number> } {
  const sf = parseTsx(file);
  const raw = zero();
  const migrated = zero();
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && /className$/i.test(node.name.getText(sf)) && node.initializer) {
      const tag = (node.parent.parent as ts.JsxOpeningLikeElement).tagName.getText(sf);
      const tokens = strings(node.initializer).join(' ').split(/\s+/);
      // A component (`<Chip className=…>`) is a primitive or owns its markup.
      const into = MIGRATED_TAGS.has(tag)
        ? migrated
        : /^[a-z]/.test(tag) && !CONTROL_TAGS.has(tag)
          ? raw
          : null;
      if (into) for (const shape of SHAPES) if (tokens.some(matches[shape])) into[shape]++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { raw, migrated };
}

const BOARD_CHROME =
  'PERMANENT: playtest and live-table board chrome is bespoke (E435 scope ruling, kept for T166)';
const OWN_PRIMITIVE =
  'PERMANENT: this component is itself the primitive for its glyph family (§ Manual price-override badge: the small square glyph chip)';
const SHOWS_ZERO =
  'PERMANENT: a count that shows 0 on purpose, and Count renders nothing at 0 (T166 W3)';
const ROLE_TEXT =
  'PERMANENT: role marks are coloured text from the 15-role hue map, not a pill (its CSS: "Plain coloured text, no pill")';
const DOMAIN_BADGE =
  'PERMANENT: a domain badge rendered both on list rows and inside a grid tile art cluster, with interactive variants; the component owns its markup (T166 W2)';
const FALSE_FRIEND =
  'PERMANENT: named like a badge or pill but not one (a spinner, an avatar glyph, an input container, a paragraph with a link, a skeleton bar)';
const LAYOUT_WRAPPER =
  'PERMANENT: the layout wrapper holding a verdict Chip and its reason, not a badge itself';

type Entry = { count: number; why: string };

/** What stays raw after T166, each with the ruling that keeps it. */
const ALLOWED: Record<Shape, Record<string, Entry>> = {
  rawBadge: {
    'components/BinderBadge.tsx': { count: 2, why: DOMAIN_BADGE },
    'components/DeckBadge.tsx': { count: 1, why: DOMAIN_BADGE },
    'components/card/CardPreview.tsx': { count: 1, why: ROLE_TEXT },
    'components/Legend.tsx': { count: 1, why: ROLE_TEXT },
    'components/deck/DeckMainboardRow.tsx': { count: 1, why: ROLE_TEXT },
    'components/deck/DeckToolbar.tsx': { count: 1, why: ROLE_TEXT },
    'components/FoilBadge.tsx': { count: 1, why: OWN_PRIMITIVE },
    'components/shared/PriceOverrideBadge.tsx': { count: 1, why: OWN_PRIMITIVE },
    'components/shared/ProxyBadge.tsx': { count: 1, why: OWN_PRIMITIVE },
    'components/shared/RarityBadge.tsx': { count: 1, why: OWN_PRIMITIVE },
    'components/profile/ProfileEditor.tsx': { count: 1, why: FALSE_FRIEND },
    'components/app-shell/PullToRefresh.tsx': { count: 1, why: FALSE_FRIEND },
    'components/search/SearchPill.tsx': { count: 1, why: FALSE_FRIEND },
    'components/search/SetFilterPicker.tsx': { count: 1, why: FALSE_FRIEND },
    'components/deck/ForkedFromBadge.tsx': { count: 1, why: FALSE_FRIEND },
    'components/play/GameNights.tsx': { count: 1, why: FALSE_FRIEND },
    'components/overlays/Tabs.tsx': { count: 1, why: SHOWS_ZERO },
    'components/deck/DeckCustomizer.tsx': { count: 1, why: SHOWS_ZERO },
    'components/deck/VerdictBadge.tsx': { count: 1, why: LAYOUT_WRAPPER },
    'components/play/GameBoard.tsx': { count: 5, why: BOARD_CHROME },
    'components/play/OnlineGameView.tsx': { count: 6, why: BOARD_CHROME },
    'playtest/components/LifeStrip.tsx': { count: 6, why: BOARD_CHROME },
    'playtest/components/OpeningHandSheet.tsx': { count: 1, why: BOARD_CHROME },
    'playtest/components/PlaytestBoard.tsx': { count: 1, why: BOARD_CHROME },
    'playtest/components/PlaytestStatsSheet.tsx': { count: 4, why: BOARD_CHROME },
    'playtest/components/TableTicker.tsx': { count: 1, why: BOARD_CHROME },
    'playtest/components/ZoneViewerModal.tsx': { count: 2, why: BOARD_CHROME },
  },
  rawSurface: {},
  rawSectionHead: {},
};

const HOW: Record<Shape, string> = {
  rawBadge:
    'On card art, render ArtBadge; a number, Count; anything else, a label Chip with its tone (all components/shared).',
  rawSurface: 'Render Surface from components/shared/Surface with its variant.',
  rawSectionHead: 'Render SectionHeader from components/shared/SectionHeader.',
};

describe('badges, counts, surfaces and section headers come from the display primitives', () => {
  const found: Record<Shape, Map<string, number>> = {
    rawBadge: new Map(),
    rawSurface: new Map(),
    rawSectionHead: new Map(),
  };
  const migrated = zero();
  for (const file of sourceFiles(srcDir)) {
    const rel = relative(srcDir, file).split(sep).join('/');
    if (PRIMITIVES.has(rel)) continue;
    const n = count(file);
    for (const shape of SHAPES) {
      if (n.raw[shape]) found[shape].set(rel, n.raw[shape]);
      migrated[shape] += n.migrated[shape];
    }
  }

  for (const shape of SHAPES) {
    it(`no new ${shape} outside the allowlist`, () => {
      const over = [...found[shape]]
        .filter(([file, n]) => n > (ALLOWED[shape][file]?.count ?? 0))
        .map(([file, n]) => `${file} (${n}, allowed ${ALLOWED[shape][file]?.count ?? 0})`);
      expect(over, `${HOW[shape]}\n  ${over.join('\n  ')}`).toEqual([]);
    });

    it(`the ${shape} allowlist has no stale entries`, () => {
      const stale = Object.entries(ALLOWED[shape])
        .filter(([file, e]) => (found[shape].get(file) ?? 0) < e.count)
        .map(([file, e]) => `${file} (allowed ${e.count}, found ${found[shape].get(file) ?? 0})`);
      expect(stale, 'Lower or delete these entries:\n  ' + stale.join('\n  ')).toEqual([]);
    });
  }

  it('every allowlist entry is a PERMANENT exemption with its reason', () => {
    // The migration is finished: an entry without a ruling would be new debt.
    const bare = SHAPES.flatMap((shape) =>
      Object.entries(ALLOWED[shape])
        .filter(([, e]) => !e.why.startsWith('PERMANENT'))
        .map(([file]) => `${shape}: ${file}`)
    );
    expect(
      bare,
      'Move these onto the primitives, or record the ruling that exempts them:\n  ' +
        bare.join('\n  ')
    ).toEqual([]);
  });

  it('the scan recognises the migrated call sites (guards the guard)', () => {
    // A matcher change that silently stopped recognising a family would pass
    // every case above. Each shape's classes must still be found on the
    // primitives that now carry them.
    for (const shape of SHAPES) expect(migrated[shape], shape).toBeGreaterThan(0);
  });
});
