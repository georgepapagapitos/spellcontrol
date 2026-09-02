// @vitest-environment happy-dom
/**
 * Page-level axe gate at phone width (390px, coarse pointer).
 *
 * The primitive smoke test (`components/a11y.smoke.test.tsx`) proves the
 * shared building blocks are sound in isolation; this one renders each
 * real route inside the real app shell (`Layout`: header, main, mobile tab
 * bar, footer) and runs axe over the whole document, so landmark structure,
 * labels and ARIA relationships are checked the way a screen reader meets
 * them. Every page is a live component with its stores seeded and the
 * network guarded (setup.ts rejects fetch), so what renders is the page's
 * real first paint plus its error / empty branches.
 *
 * Rules deliberately off, with the reason:
 *   - color-contrast: happy-dom has no layout engine and computes no
 *     styles, so the rule can only produce noise. Contrast is checked in
 *     the browser (Part 1 screenshots) and by the design tokens.
 *
 * Per-route allowances (`allow`) document findings judged to be false
 * positives in THIS environment, each with its reason. A new violation on
 * any route still fails.
 */
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import * as matchers from 'vitest-axe/matchers';
import type { AxeMatchers } from 'vitest-axe/matchers';
import type { EnrichedCard } from '../types';

expect.extend(matchers);
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-object-type
  interface Matchers<T = any> extends AxeMatchers {}
}

// ── Phone environment ────────────────────────────────────────────────────
// happy-dom answers every media query "false"; the app branches on these.
function installPhoneMedia() {
  const answer = (query: string): boolean => {
    if (/max-width:\s*(600|480|700)px/.test(query)) return true;
    if (/min-width/.test(query)) return false;
    if (/pointer:\s*coarse/.test(query)) return true;
    if (/hover:\s*hover/.test(query) || /pointer:\s*fine/.test(query)) return false;
    return false;
  };
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: answer(query),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
}

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        key: index,
        index,
        start: index * 40,
        size: 40,
      })),
    getTotalSize: () => count * 40,
    measureElement: () => {},
    measure: () => {},
    scrollToIndex: () => {},
    scrollToOffset: () => {},
  }),
}));

import { Layout } from '../components/Layout';
import { useAuth } from '../store/auth';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { HomePage } from './HomePage';
import { CollectionPage } from './CollectionPage';
import { CollectionHubLayout } from '../components/CollectionHubLayout';
import { BindersIndexPage } from './BindersIndexPage';
import { ListsPage } from './ListsPage';
import { CollectionCombosPage } from './CollectionCombosPage';
import { SetsPage } from './SetsPage';
import { DecksIndexPage } from './DecksIndexPage';
import { DiscoverDecksPage } from './DiscoverDecksPage';
import { SavedDecksPage } from './SavedDecksPage';
import { DeckNewPage } from './DeckNewPage';
import { PlayPage } from './PlayPage';
import { RulesPage } from './RulesPage';
import { SearchPage } from './SearchPage';
import { TagsPage } from './TagsPage';
import { YouPage } from './YouPage';
import { FriendsPage } from './FriendsPage';
import { TradesPage } from './TradesPage';
import { PodsIndexPage } from './PodsIndexPage';
import AuthPage from './AuthPage';
import { WelcomePage } from './WelcomePage';
import { CubePage } from './CubePage';
import { DeckComparePage } from './DeckComparePage';
import { DeckEditorPage } from './DeckEditorPage';
import { PodHubPage } from './PodHubPage';
import { FriendHubPage } from './FriendHubPage';
import { PublicDeckPage } from './PublicDeckPage';
import { PublicProfilePage } from './PublicProfilePage';
import { SharedView } from './SharedView';
import { GameNightView } from './GameNightView';

const runAxe = configureAxe({
  rules: {
    'color-contrast': { enabled: false },
  },
});

let seq = 0;
function card(name: string, over: Partial<EnrichedCard> = {}): EnrichedCard {
  seq += 1;
  return {
    copyId: `copy-${seq}`,
    name,
    setCode: 'CMM',
    setName: 'Commander Masters',
    collectorNumber: String(seq),
    rarity: 'uncommon',
    scryfallId: `sf-${seq}`,
    purchasePrice: 1.5,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    typeLine: 'Artifact',
    cmc: 1,
    colorIdentity: [],
    colors: [],
    legalities: { commander: 'legal' },
    ...over,
  } as EnrichedCard;
}

interface RouteCase {
  path: string;
  /** Route path pattern + element, mounted inside <Layout/> unless `bare`. */
  routes: React.ReactNode;
  bare?: boolean;
  /** Render signed out (auth pages redirect a signed-in user away). */
  guest?: boolean;
  /** Seed a deck and return the path to open (deck routes need a real deck). */
  seedDeck?: boolean;
  /** Text that proves the page (not just the shell) rendered. */
  ready: RegExp;
  /** Known findings that are false positives here, with the reason. */
  allow?: Array<{ id: string; reason: string }>;
}

const collectionRoutes = (
  <Route path="/collection" element={<CollectionHubLayout />}>
    <Route index element={<CollectionPage />} />
    <Route path="binders" element={<BindersIndexPage />} />
    <Route path="lists" element={<ListsPage />} />
    <Route path="combos" element={<CollectionCombosPage />} />
    <Route path="sets" element={<SetsPage />} />
  </Route>
);

const CASES: RouteCase[] = [
  {
    path: '/home',
    routes: <Route path="/home" element={<HomePage />} />,
    ready: /Good (morning|afternoon|evening)|Recent decks/i,
  },
  { path: '/collection', routes: collectionRoutes, ready: /Collection/ },
  { path: '/collection/binders', routes: collectionRoutes, ready: /binder/i },
  { path: '/collection/lists', routes: collectionRoutes, ready: /list/i },
  { path: '/collection/combos', routes: collectionRoutes, ready: /combo/i },
  { path: '/collection/sets', routes: collectionRoutes, ready: /sets/i },
  { path: '/decks', routes: <Route path="/decks" element={<DecksIndexPage />} />, ready: /deck/i },
  {
    path: '/decks/discover',
    routes: <Route path="/decks/discover" element={<DiscoverDecksPage />} />,
    ready: /discover|public decks/i,
  },
  {
    path: '/decks/saved',
    routes: <Route path="/decks/saved" element={<SavedDecksPage />} />,
    ready: /saved/i,
  },
  {
    path: '/decks/new',
    routes: <Route path="/decks/new" element={<DeckNewPage />} />,
    ready: /commander|format/i,
  },
  { path: '/play', routes: <Route path="/play" element={<PlayPage />} />, ready: /Play/ },
  { path: '/rules', routes: <Route path="/rules" element={<RulesPage />} />, ready: /rules/i },
  { path: '/search', routes: <Route path="/search" element={<SearchPage />} />, ready: /search/i },
  { path: '/tags', routes: <Route path="/tags" element={<TagsPage />} />, ready: /tag/i },
  {
    path: '/you',
    routes: <Route path="/you" element={<YouPage />} />,
    ready: /you|settings|account/i,
  },
  {
    path: '/friends',
    routes: <Route path="/friends" element={<FriendsPage />} />,
    ready: /friends/i,
  },
  { path: '/trades', routes: <Route path="/trades" element={<TradesPage />} />, ready: /trades/i },
  { path: '/pods', routes: <Route path="/pods" element={<PodsIndexPage />} />, ready: /pods/i },
  {
    path: '/pods/pod-1',
    routes: <Route path="/pods/:id" element={<PodHubPage />} />,
    ready: /pod|couldn/i,
  },
  {
    path: '/friends/friend-1',
    routes: <Route path="/friends/:friendId" element={<FriendHubPage />} />,
    ready: /friend|couldn/i,
  },
  {
    path: '/decks/cube',
    routes: <Route path="/decks/cube" element={<CubePage />} />,
    ready: /cube/i,
  },
  {
    path: '/decks/compare',
    routes: <Route path="/decks/compare" element={<DeckComparePage />} />,
    ready: /compare/i,
  },
  {
    path: '/decks/DECK',
    seedDeck: true,
    routes: <Route path="/decks/:id" element={<DeckEditorPage />} />,
    ready: /Add cards/,
  },
  {
    path: '/auth',
    bare: true,
    guest: true,
    routes: <Route path="/auth" element={<AuthPage />} />,
    ready: /Create account/,
  },
  {
    path: '/',
    bare: true,
    guest: true,
    routes: <Route path="/" element={<WelcomePage />} />,
    ready: /Plan your Magic/,
  },
  {
    path: '/d/some-deck',
    bare: true,
    guest: true,
    routes: <Route path="/d/:slug" element={<PublicDeckPage />} />,
    ready: /deck|couldn|found/i,
  },
  {
    path: '/u/goblinjoe',
    bare: true,
    guest: true,
    routes: <Route path="/u/:username" element={<PublicProfilePage />} />,
    ready: /went wrong|profile|couldn|found/i,
  },
  {
    path: '/s/tok',
    bare: true,
    guest: true,
    routes: <Route path="/s/:token" element={<SharedView />} />,
    ready: /went wrong|shared|couldn|found|sign in/i,
  },
  {
    path: '/gn/tok',
    bare: true,
    guest: true,
    routes: <Route path="/gn/:token" element={<GameNightView />} />,
    ready: /game night|couldn|found/i,
  },
];

beforeAll(() => {
  installPhoneMedia();
});

beforeEach(() => {
  seq = 0;
  localStorage.clear();
  sessionStorage.clear();
  useAuth.setState({
    status: 'authed',
    user: { id: 'u1', username: 'goblinjoe', role: 'user' },
  } as never);
  useCollectionStore.setState({
    hydrating: false,
    cards: [
      card('Sol Ring'),
      card('Lightning Bolt', {
        typeLine: 'Instant',
        colorIdentity: ['R'],
        colors: ['R'],
        rarity: 'common',
      }),
      card('Krenko, Mob Boss', {
        typeLine: 'Legendary Creature — Goblin Warrior',
        colorIdentity: ['R'],
        colors: ['R'],
        rarity: 'rare',
        cmc: 4,
      }),
    ],
  } as never);
  useDecksStore.setState({ hydrated: true, decks: [] } as never);
});

afterEach(() => {
  cleanup();
});

describe('a11y (axe): full routes at phone width', () => {
  for (const c of CASES) {
    it(`${c.path} has no violations beyond the documented allowances`, async () => {
      if (c.guest) useAuth.setState({ status: 'guest', user: null } as never);
      let path = c.path;
      if (c.seedDeck) {
        const deck = useDecksStore.getState().createDeck({
          name: 'Goblins',
          format: 'commander',
          source: 'manual',
          commander: null,
          cards: [],
        });
        path = `/decks/${typeof deck === 'string' ? deck : (deck as { id: string }).id}`;
      }
      render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>{c.bare ? c.routes : <Route element={<Layout />}>{c.routes}</Route>}</Routes>
        </MemoryRouter>
      );
      try {
        await screen.findAllByText(c.ready, {}, { timeout: 8000 });
      } catch (err) {
        throw new Error(
          `${c.path} never rendered ${c.ready}. Body text: ${document.body.textContent?.slice(0, 400)}`,
          { cause: err }
        );
      }
      // Let the page's mount effects (guarded fetches → error/empty states)
      // settle so axe sees the steady-state DOM, not the first frame.
      await new Promise((r) => setTimeout(r, 250));
      const results = await runAxe(document.body);
      const allowed = new Set((c.allow ?? []).map((a) => a.id));
      const unexpected = results.violations.filter((v) => !allowed.has(v.id));
      const report = unexpected.map(
        (v) =>
          `${v.id} (${v.impact}): ${v.help}\n` +
          v.nodes
            .slice(0, 4)
            .map((n) => `    ${n.target.join(' ')}: ${n.failureSummary?.split('\n')[1] ?? ''}`)
            .join('\n')
      );
      expect(report).toEqual([]);
    }, 60_000);
  }
});
