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
// The migration is in progress (T166 W1-W5): ALLOWED holds each file's
// current count and only goes down. A file that stops matching must leave
// the list (the stale check). When the last wave lands, what remains becomes
// PERMANENT exemptions with their rulings, the way T152 W7 locked its guard.

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

function count(file: string): Record<Shape, number> {
  const sf = parseTsx(file);
  const n: Record<Shape, number> = { rawBadge: 0, rawSurface: 0, rawSectionHead: 0 };
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && /className$/i.test(node.name.getText(sf)) && node.initializer) {
      const tag = (node.parent.parent as ts.JsxOpeningLikeElement).tagName.getText(sf);
      // A component (`<Chip className=…>`) is a primitive or owns its markup.
      if (/^[a-z]/.test(tag) && !CONTROL_TAGS.has(tag)) {
        const tokens = strings(node.initializer).join(' ').split(/\s+/);
        if (
          tokens.some(
            (t) =>
              (BADGE_CLASS.test(t) && !CONTROL_CLASSES.has(t)) ||
              COUNT_BUBBLES.has(t) ||
              ART_BADGES.has(t)
          )
        )
          n.rawBadge++;
        if (tokens.some((t) => SURFACE_CLASSES.has(t))) n.rawSurface++;
        if (tokens.some((t) => SECTION_HEAD_CLASS.test(t))) n.rawSectionHead++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return n;
}

/** Files still to migrate, with their current counts. Lower as each wave lands. */
const ALLOWED: Record<Shape, Record<string, number>> = {
  rawBadge: {
    'components/AdminPanel.tsx': 3,
    'components/BinderBadge.tsx': 2,
    'components/BinderCardEditor.tsx': 1,
    'components/BinderSummaryBar.tsx': 1,
    'components/BinderTabs.tsx': 1,
    'components/CardEditDialog.tsx': 3,
    'components/CardPreview.tsx': 1,
    'components/CardScanner.tsx': 1,
    'components/CollectionFiltersDialog.tsx': 1,
    'components/DeckBadge.tsx': 1,
    'components/DiscoverDeckTile.tsx': 2,
    'components/FoilBadge.tsx': 1,
    'components/Header.tsx': 2,
    'components/Legend.tsx': 1,
    'components/MobileTabBar.tsx': 1,
    'components/ProfileEditor.tsx': 1,
    'components/PullToRefresh.tsx': 1,
    'components/RulesReference.tsx': 1,
    'components/ScannerQueueSheet.tsx': 3,
    'components/SearchPill.tsx': 1,
    'components/SetFilterPicker.tsx': 1,
    'components/Tabs.tsx': 2,
    'components/aggregates/TrendingRail.tsx': 2,
    'components/deck/BracketBreakdown.tsx': 1,
    'components/deck/CardSearchPanel.tsx': 3,
    'components/deck/ComboRow.tsx': 1,
    'components/deck/CommanderResultCard.tsx': 1,
    'components/deck/CommanderSearch.tsx': 1,
    'components/deck/DeckCustomizer.tsx': 2,
    'components/deck/DeckMainboardRow.tsx': 2,
    'components/deck/DeckToolbar.tsx': 1,
    'components/deck/ForkedFromBadge.tsx': 1,
    'components/deck/GenerationModePicker.tsx': 1,
    'components/deck/OwnershipBadge.tsx': 1,
    'components/deck/PullListSheet.tsx': 1,
    'components/deck/VerdictBadge.tsx': 1,
    'components/deck/WinConditionPanel.tsx': 1,
    'components/deck/import-deck-shared.tsx': 1,
    'components/decks/DeckLibrary.tsx': 2,
    'components/home/WaitingOnYou.tsx': 1,
    'components/play/GameBoard.tsx': 5,
    'components/play/GameNights.tsx': 7,
    'components/play/OnlineGameView.tsx': 6,
    'components/play/OnlineLobby.tsx': 1,
    'components/play/horde/HordeTile.tsx': 1,
    'components/share/SharedGameSummaryView.tsx': 1,
    'components/shared/FilterTrigger.tsx': 1,
    'components/shared/PriceOverrideBadge.tsx': 1,
    'components/shared/ProxyBadge.tsx': 1,
    'components/shared/RarityBadge.tsx': 1,
    'components/trade/TradeComposer.tsx': 1,
    'pages/BinderPage.tsx': 2,
    'pages/BindersIndexPage.tsx': 4,
    'pages/DeckComparePage.tsx': 1,
    'pages/DecksIndexPage.tsx': 2,
    'pages/GameNightView.tsx': 3,
    'pages/PlayPage.tsx': 1,
    'pages/PodHubPage.tsx': 1,
    'pages/SetsPage.tsx': 2,
    'pages/TradesPage.tsx': 1,
    'pages/cube/CubeCommanders.tsx': 2,
    'pages/cube/CubeDraftabilityPanel.tsx': 1,
    'pages/cube/CubeResult.tsx': 4,
    'playtest/components/LifeStrip.tsx': 6,
    'playtest/components/OpeningHandSheet.tsx': 1,
    'playtest/components/PlaytestBoard.tsx': 1,
    'playtest/components/PlaytestStatsSheet.tsx': 4,
    'playtest/components/TableTicker.tsx': 1,
    'playtest/components/ZoneViewerModal.tsx': 2,
  },
  rawSurface: {
    'components/AdminPanel.tsx': 3,
    'components/BinderEditor.tsx': 1,
    'components/ComboFiltersPopover.tsx': 1,
    'components/DeckFiltersPopover.tsx': 1,
    'components/DiscoverDeckTile.tsx': 2,
    'components/DiscoverFiltersPopover.tsx': 1,
    'components/ErrorBoundary.tsx': 2,
    'components/GuestActionPopover.tsx': 1,
    'components/OfflineModeSettings.tsx': 1,
    'components/RuleFieldPicker.tsx': 1,
    'components/SelectMenu.tsx': 1,
    'components/SortPopover.tsx': 1,
    'components/StatsBar.tsx': 3,
    'components/UploadPanel.tsx': 1,
    'components/ValueTrend.tsx': 1,
    'components/deck/CardSearchPanel.tsx': 1,
    'components/deck/CoachFeed.tsx': 1,
    'components/deck/CollapsibleLane.tsx': 1,
    'components/deck/DeckAiConsent.tsx': 1,
    'components/deck/DeckAiRefine.tsx': 1,
    'components/deck/DeckAiReview.tsx': 1,
    'components/deck/DeckAnalysisPanel.tsx': 1,
    'components/deck/DeckCombosPanel.tsx': 1,
    'components/deck/DeckIdentityCard.tsx': 1,
    'components/deck/DeckTestHandPanel.tsx': 1,
    'components/deck/PartnerCommanderSelector.tsx': 1,
    'components/decks/DeckLibrary.tsx': 1,
    'components/home/DiscoverRow.tsx': 1,
    'components/home/HomeCard.tsx': 1,
    'components/home/YourDecks.tsx': 2,
    'components/play/GameNights.tsx': 2,
    'components/play/PlayHome.tsx': 2,
    'components/settings/SettingsSection.tsx': 1,
    'components/shared/ToolbarPopover.tsx': 1,
    'components/trade/TradeAcceptDialog.tsx': 1,
    'components/trade/TradeOfferList.tsx': 1,
    'pages/AuthPage.tsx': 1,
    'pages/BindersIndexPage.tsx': 2,
    'pages/ChooseUsernamePage.tsx': 1,
    'pages/CollectionCombosPage.tsx': 1,
    'pages/DecksIndexPage.tsx': 1,
    'pages/ForgotPasswordPage.tsx': 1,
    'pages/FriendHubPage.tsx': 1,
    'pages/ListsPage.tsx': 1,
    'pages/PodHubPage.tsx': 2,
    'pages/PublicProfilePage.tsx': 1,
    'pages/ResetPasswordPage.tsx': 2,
    'pages/SearchPage.tsx': 1,
    'pages/VerifyEmailPage.tsx': 1,
    'pages/YouPage.tsx': 1,
  },
  rawSectionHead: {
    'components/deck/CommanderOpenSlot.tsx': 1,
    'components/deck/DeckCardGrid.tsx': 1,
    'components/deck/DeckMainboardRow.tsx': 1,
    'components/home/DiscoverRow.tsx': 1,
    'components/home/YourDecks.tsx': 1,
    'components/settings/AiFeaturesSettings.tsx': 1,
    'components/share/SharedCubeView.tsx': 1,
    'pages/FriendHubPage.tsx': 4,
    'pages/PodHubPage.tsx': 3,
    'pages/TradesPage.tsx': 1,
    'pages/YouPage.tsx': 3,
  },
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
  for (const file of sourceFiles(srcDir)) {
    const rel = relative(srcDir, file).split(sep).join('/');
    if (PRIMITIVES.has(rel)) continue;
    const n = count(file);
    for (const shape of Object.keys(n) as Shape[]) if (n[shape]) found[shape].set(rel, n[shape]);
  }

  for (const shape of Object.keys(ALLOWED) as Shape[]) {
    it(`no new ${shape} outside the allowlist`, () => {
      const over = [...found[shape]]
        .filter(([file, n]) => n > (ALLOWED[shape][file] ?? 0))
        .map(([file, n]) => `${file} (${n}, allowed ${ALLOWED[shape][file] ?? 0})`);
      expect(over, `${HOW[shape]}\n  ${over.join('\n  ')}`).toEqual([]);
    });

    it(`the ${shape} allowlist has no stale entries`, () => {
      const stale = Object.entries(ALLOWED[shape])
        .filter(([file, n]) => (found[shape].get(file) ?? 0) < n)
        .map(([file, n]) => `${file} (allowed ${n}, found ${found[shape].get(file) ?? 0})`);
      expect(stale, 'Lower or delete these entries:\n  ' + stale.join('\n  ')).toEqual([]);
    });
  }

  it('the scan sees the codebase (guards the guard)', () => {
    // A parser change that silently matched nothing would pass every case
    // above; each shape has real call sites until its wave lands.
    for (const shape of Object.keys(ALLOWED) as Shape[])
      expect(found[shape].size, shape).toBeGreaterThan(0);
  });
});
