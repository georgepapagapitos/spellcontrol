# Architecture

A map of where things live and where new code goes. The README says what the
app does and how to run it; this file is for finding your way around the code.
It names directories and rules, not individual files, so it stays true as files
come and go. If a rule here and the code disagree, the guard test named next to
the rule is the authority.

## The five packages

```
backend/                  Express 5 API, also serves the built frontend
frontend/                 React 19 single-page app (Vite)
packages/game-core/       the game-state reducer, run by both apps
packages/binder-routing/  card-to-binder rule matching, filtering, sorting
packages/deck-metrics/    the Commander bracket estimator
```

Each has its own `package.json`, dependency tree and test suite; the root
`package.json` only holds shared dev tooling. The three `packages/*` are
zero-dependency and isomorphic: anything that must give the same answer on
the server and in the browser lives there, and both apps import it as
`@spellcontrol/<name>`. Logic that only one app needs stays in that app.

## Frontend (`frontend/src/`)

### Layers

```
pages/        one file per route, composes components
  |
components/   React UI, grouped by product area
  |
store/        Zustand stores (app state, persistence, sync hooks)
lib/          plain logic and hooks: parsing, filtering, API clients
types/        shared TypeScript types
```

Imports point down this list, never up. Non-UI code (`lib`, `store`, `types`,
the deck builder's `services`/`lib`/`store`/`types`, `playtest/lib`) imports
nothing from `components` or `pages`; no component imports a page;
`components/shared/` imports no feature folder. Guard:
`src/test/layer-boundaries.test.ts`. Value-level import cycles are banned
outright: `src/import-cycles.test.ts`. The fix for either is the same: move
the shared piece down into its own module, never import back up.

### Directories

| Directory            | Holds                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pages/`             | Route components. `App.tsx` maps every URL to one, each lazy-loaded. `pages/cube/` and `pages/you/` hold the sub-pages of those two hubs. A page's own stylesheet sits next to it.                                                                                                                                      |
| `components/shared/` | The primitives every surface uses: `Button`, `Chip`, `Surface`, `SectionHeader`, `CardGridCell`, `CardRow`, `MeterBar`, `ManaSymbol`, the form kit. The **Primitives index** at the top of `frontend/STYLE_GUIDE.md` lists them; check it before building any small control.                                            |
| `components/<area>/` | UI for one product area: `deck/` (the deck page), `play/` (life counter, online table, game nights), `home/`, `trade/`, `browse/`, `settings/`, `welcome/`, `aggregates/`. `share/` is the public share-link feature (`/s/…`, `/d/…`), not primitives.                                                                  |
| `components/` (root) | Everything else: collection, binders, card preview, scanner, overlays (`Modal`, `OverflowMenu`, `SelectMenu`, `Tabs`). Moving these into area folders is in progress (board T176).                                                                                                                                      |
| `store/`             | One Zustand store per domain (`collection`, `decks`, `play`, `cube`, `auth`, `theme`, …). Mutators persist through `lib/sync.ts`.                                                                                                                                                                                       |
| `lib/`               | Logic with no JSX. Subfolders hold the larger self-contained domains (`cube/`, `horde/`, `mana-sim/`, `offline/`, `playtest/`, `scanner/`); the rest is flat for now and grouped by filename prefix (`binder-*`, `deck-*`, `trade-*`, `use-*` for hooks).                                                               |
| `deck-builder/`      | The Commander generator and deck analysis: `services/` (generator, analyzer, EDHREC, Scryfall and tagger clients, card facts, synergy), its own `store/`, `types/`, `hooks/`, and `components/brew/` for Brew mode. Self-contained; the rest of the app calls in through `lib/save-generated-deck.ts` and the analyzer. |
| `playtest/`          | The goldfish board (`/decks/:id/playtest`): its own `store.ts`, `components/`, `hooks/`, `lib/`.                                                                                                                                                                                                                        |
| `styles/`            | Global CSS: `tokens.css` (every colour, space, radius, type and motion value), themes, and the stylesheets shared across pages. The `*.test.ts` files beside them are the CSS guards (tokens only, focus rings, touch targets, contrast).                                                                               |
| `test/`              | Whole-tree structural guards (primitive usage, copy, a11y patterns, layering, file size) and the test setup. Each guard's header comment says what it protects and how to fix a failure.                                                                                                                                |

### Finding a product area

Until the flat folders are regrouped, a product area spans the layers under a
shared name. Search by that name across `pages/`, `components/`, `lib/`,
`store/` and `backend/src/`:

| Area                                          | Start at                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Collection & binders                          | `pages/CollectionPage.tsx`, `pages/BinderPage.tsx`, `store/collection.ts`, `lib/binder-*`, `@spellcontrol/binder-routing` |
| Deck page                                     | `pages/DeckEditorPage.tsx`, `components/deck/`, `store/decks.ts`, `lib/deck-*`                                            |
| Deck generation                               | `pages/DeckGeneratePage.tsx`, `deck-builder/services/deckBuilder/`                                                        |
| Playtest (goldfish)                           | `playtest/`, `lib/playtest/`                                                                                              |
| Play: life counter, online table, game nights | `pages/PlayPage.tsx`, `components/play/`, `store/play.ts`, `@spellcontrol/game-core`, `backend/src/routes/games.ts`       |
| Cube                                          | `pages/cube/`, `lib/cube/`, `store/cube.ts`                                                                               |
| Friends, pods, trades                         | `pages/Friend*`, `pages/Pod*`, `pages/TradesPage.tsx`, `components/trade/`, `backend/src/{friends,pods}/`                 |
| Share links                                   | `components/share/`, `pages/SharedView.tsx`, `backend/src/shares/`                                                        |
| Scanner                                       | `components/CardScanner.tsx`, `lib/scanner/`                                                                              |
| Sync & offline                                | `lib/sync.ts`, `lib/offline/`, `backend/src/routes/sync.ts`                                                               |
| AI review, refine, rules Q&A                  | `lib/ai-*`, `backend/src/ai/`                                                                                             |

### Conventions

- **Naming.** Components and pages are `PascalCase.tsx`; everything else is
  `kebab-case.ts`; hooks start with `use-` (file) and `use` (export).
- **Co-location.** A test sits next to its module as `*.test.ts(x)`. A
  component's own CSS sits next to it and is imported by it; which stylesheet
  loads with which page is pinned by `styles/css-chunk-ownership.test.ts`.
- **Imports.** `@/` is `frontend/src`. Prefer `@/` over climbing out of a
  directory with `../../`.
- **Size.** No source file over 1,000 lines. The files already past it have a
  ceiling that only goes down: `src/test/file-size-ratchet.test.ts` (and the
  backend twin). Split by extracting a component, hook or helper next to it.
- **UI rules** live in `frontend/STYLE_GUIDE.md` and its appendices in
  `frontend/style-guide/`. Copy rules are enforced by `src/copy-guards.test.ts`.

## Backend (`backend/src/`)

| Directory / file           | Holds                                                                                                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server.ts`                | App setup, security middleware, the card/import/sets endpoints, and the mount point for every router.                                                                                                                                                                           |
| `routes/`                  | One Express router per domain (`auth`, `sync`, `games`, `trades`, `ai`, …): request parsing, auth, rate limits, responses. A new router is mounted in `server.ts` **and** in `test-helpers.ts`, or its tests 404.                                                               |
| `<domain>/`                | That domain's logic, kept out of the router so it can be tested without HTTP: `ai/`, `combos/`, `friends/`, `games/`, `pods/`, `shares/`, `publications/`, `parsers/` (import format detection), …                                                                              |
| `db/`                      | Postgres via Drizzle. `schema.ts` holds the query types; `index.ts:ensureSchema()` creates the tables at boot. There is no migration tool: a schema change goes in both, plus the test DDL in `test-helpers.ts` (`db/schema-parity.test.ts` checks the two real schemas match). |
| `scryfall*.ts`, `cache.ts` | The shared Scryfall card cache in SQLite.                                                                                                                                                                                                                                       |
| `scripts/`                 | One-off and scheduled jobs (combo ingest and the like), run by the workflows in `.github/workflows/`.                                                                                                                                                                           |

Every backend test runs against a real Postgres (a throwaway container unless
`TEST_DATABASE_URL` is set); each test file gets its own schema.

## Shared packages

- **`game-core`** owns `applyAction`, the pure reducer for a game. Online
  games run it on the server (authoritative, stored as JSONB); local games and
  optimistic updates run the same function in the browser. Keep it pure.
- **`binder-routing`** decides which binder a card belongs in, and filters and
  sorts binder contents, for the live binder views and shared-binder pages.
- **`deck-metrics`** estimates a deck's Commander bracket. Tag data is passed
  in (`TagLookup`), so the package does no I/O.

A new shared package also needs a build stage in `backend/Dockerfile`;
`scripts/check-shared-package-registration.mjs` fails CI if it is missing.

## Data flow in one paragraph

A signed-in user's collection, binders and decks live in IndexedDB in the
browser and in Postgres on the server. A store mutation writes the changed
rows locally, then `lib/sync.ts` pushes them (`POST /api/sync`) and pulls
other devices' changes by revision (`GET /api/sync?since=`). The server wins,
per row, by most recent write. Card data comes from Scryfall through the
backend's SQLite cache; deck suggestions come from EDHREC through the deck
builder's clients. The README's "Where data lives" section has the full list.
