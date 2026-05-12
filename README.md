# MTG Binder Planner

Plan your physical Magic: The Gathering binders. Import a collection export from any popular tool, define binders with custom rules, generate EDHREC-powered Commander decks, and sync everything across devices with an optional account.

## What you can do

- **Import a collection** from ManaBox / Moxfield / Archidekt / Deckbox / TCGplayer / Cardsphere / MTGA / plain text. Format is auto-detected.
- **Define binders** as a set of OR-grouped match rules plus a sort spec and pocket size (4, 9, 12, or 18). Drag to reorder binders and control which gets first dibs on each card.
- **View binders** as physical pages or as a flat list, with a card preview pane and per-binder export.
- **Build decks** with a commander / companion / sideboard structure, search Scryfall for cards, customize sleeves and themes, and see which deck copies are pulled from your collection.
- **Generate decks** from EDHREC data — pick a commander, choose themes, set a bracket level, and get a full 100-card deck with mana curve balancing and role targeting.
- **Browse your collection** in a sortable, filterable table with breakdowns by color, type, rarity, and price.
- **Sign in and sync** — create an account to sync your collection, binders, and decks to the server. Changes push automatically and pull on login.
- **Skin the app** with a guild theme — accents, surfaces, and warning / error colors all re-tint per theme.

## How it works

1. **Import** — drop a CSV / TSV / text file or paste a list. The backend resolves every row against a cached Scryfall mirror and returns enriched cards.
2. **Sign in (optional)** — create an account to sync your collection, binders, and decks to the server. Changes push automatically and pull on login.
3. **Define binders** — each binder has one or more match groups. A card joins the first binder (in tab order) that matches.
4. **Watch the Uncategorized bucket shrink** — anything that does not match any binder lives there until you write a rule for it.
5. **Allocate decks** — cards reserved by a deck are tagged on the binder side, so you can tell at a glance which slots are spoken for.

## Supported import formats

The importer auto-detects the format from the file's columns and shape:

| Format                                             | How it is recognized                                       | Resolution strategy                   |
| -------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------- |
| **ManaBox CSV / TSV**                              | Tab-delimited with `Scryfall ID` and `Binder Name` columns | Direct Scryfall ID lookup             |
| **Moxfield CSV**                                   | `Count`, `Tradelist Count`, `Edition` columns              | Name + set + collector                |
| **Archidekt CSV**                                  | `Name`, `Edition`, `Quantity` columns                      | Name + set + collector                |
| **Deckbox / TCGplayer / Cardsphere / generic CSV** | Any CSV with a `Name` or `Card Name` column                | Whatever fields are present           |
| **MTGA / Arena export**                            | `1 Sol Ring (CMR) 472` lines                               | Name + set + collector                |
| **Plain text**                                     | One card name per line, optional `1x` prefix               | Name only (Scryfall picks a printing) |

Quantities, split cards (`Fire // Ice`), DFCs, adventure cards, and foil notation (`*F*`, `[FOIL]`) all parse correctly across every format.

## Rule fields

Each binder has one or more **match groups**. A card joins the binder if it matches **any** group (OR). Within a group, every set field must match (AND). Empty fields impose no constraint.

- **Rarity** — multi-select.
- **Color identity** — Scryfall color identity. `M` matches any multicolor.
- **Type** — substring match against the Scryfall type line. ANY of the selected types matches.
- **Price range** — min / max in USD.
- **CMC range** — min / max mana value.
- **Mana cost** — exact match on the normalized cost string.
- **Name contains** — case-insensitive substring.
- **Oracle text contains** — case-insensitive substring on rules text.
- **Set codes** — comma-separated, exact match.
- **Foil** — any / foil only / non-foil only.
- **Finishes** — IS / IS NOT against the finish you actually own.
- **Layouts** — IS / IS NOT against the card layout (normal, modal_dfc, adventure, etc).
- **Treatments** — IS / IS NOT against frame effects (showcase, extended, fullart, etc).
- **Border colors** — IS / IS NOT against the border color.
- **Legalities** — IS / IS NOT against format-legal status (commander, modern, etc).
- **Source category contains** — substring on the original category from your import (ManaBox binder name, Moxfield tag, etc).
- **EDHREC popularity** — "Top N most popular EDH cards" from Scryfall's `edhrec_rank`.

## Where data lives

- **User accounts** — Postgres on the backend (`users` table, bcrypt password hashes with 12 salt rounds, session JWTs in httpOnly cookies).
- **Synced state (collection, binders, decks)** — Postgres on the backend (`user_data` table, JSONB columns, optimistic-concurrency `version`). Pulled on login, debounced-pushed on every change.
- **Local cache** — `localStorage` (binders, decks, theme) and `IndexedDB` (collection cards) in the browser. Hydrated from the server snapshot after login; wiped on sign-out.
- **Scryfall card data** — cached server-side in SQLite for 7 days. Shared across all users of the backend.

## Setup

### Prerequisites

- **Node.js 20 or newer**
- A C++ toolchain (for `better-sqlite3`):
  - macOS: `xcode-select --install`
  - Linux: `sudo apt install build-essential python3`
  - Windows: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload

### Local development

```bash
npm install                              # root dev tools (concurrently, husky, prettier)
npm install --prefix frontend
npm install --prefix backend
npm run dev                              # backend on :3737, frontend on :5173
```

Open http://localhost:5173. Vite proxies `/api` to the backend.

Run them separately if you prefer:

```bash
npm run dev --prefix backend             # :3737
npm run dev --prefix frontend            # :5173
```

### Docker

A `docker-compose.yml` is included that runs Postgres + the backend + the frontend. Copy `.env.example` to `.env` and fill in `POSTGRES_PASSWORD` and `JWT_SECRET` first:

```bash
cp .env.example .env
# edit .env — generate a JWT secret with:  openssl rand -base64 48
docker compose up -d                     # postgres (internal), backend (internal), frontend :8088
```

The backend container is no longer published to the host. The frontend container's nginx proxies `/api/` to it on the docker-compose network, so a single `binder.example.com` reverse-proxy entry is enough.

Backend and frontend images are tagged `ghcr.io/georgepapagapitos/mtg-binder-{backend,frontend}:latest` and built by GitHub Actions on every push to `main`. Watchtower labels are set, so a Watchtower instance will auto-update both containers.

#### Dev database

For local development, `docker-compose.dev.yml` runs just the Postgres container. Use `npm run db:up` and `npm run db:down` to start and stop it.

#### Postgres backups

The data lives in the `binder-postgres` named volume. A nightly logical backup is recommended:

```bash
docker exec binder-postgres pg_dump -U binder binder | gzip > /backups/binder-$(date +%F).sql.gz
```

Wire that into cron and rotate the files. Restore with `gunzip -c file.sql.gz | docker exec -i binder-postgres psql -U binder binder`.

### Required environment

The backend reads:

- `DATABASE_URL` — Postgres connection string. Required.
- `JWT_SECRET` — 16+ character random string used to sign session tokens. Required. Rotating it invalidates every session.
- `PORT` (default `3737`), `DB_PATH` (default `backend/data/scryfall-cache.db`).

## Architecture

```
mtg-binder-planner/
├── backend/                              Node + Express 5 + TypeScript + Postgres + SQLite
│   └── src/
│       ├── server.ts                     Routes, helmet, rate limiting, multer
│       ├── auth.ts                       bcrypt hashing, JWT signing and verification
│       ├── cache.ts                      SQLite-backed Scryfall cache (TTL 7 days)
│       ├── scryfall.ts                   Resolve by id / name+set+collector / name; printings fetch
│       ├── sets.ts                       Cached set metadata
│       ├── types.ts                      EnrichedCard, response types
│       ├── db/
│       │   ├── index.ts                  Postgres connection pool (pg)
│       │   └── schema.ts                 users + user_data table DDL (Drizzle)
│       ├── routes/
│       │   ├── auth.ts                   Register, login, logout, me, delete account
│       │   └── sync.ts                   GET/PUT user data snapshots
│       └── parsers/
│           ├── index.ts                  Format detection and dispatch
│           ├── manabox.ts                ManaBox TSV
│           ├── csv.ts                    Moxfield / Archidekt / Deckbox / TCGplayer / Cardsphere / generic
│           ├── text.ts                   MTGA + plain text
│           └── types.ts                  Normalized ImportRow
└── frontend/                             React 18 + Vite + TypeScript + Zustand + react-router-dom 7
    └── src/
        ├── App.tsx                       Routes and auth guard
        ├── main.tsx                      Entrypoint
        ├── pages/
        │   ├── AuthPage.tsx              Login and registration
        │   ├── CollectionPage.tsx        Sortable, filterable collection table
        │   ├── BinderPage.tsx            Active binder with pages / list toggle
        │   ├── DecksIndexPage.tsx        Deck list
        │   ├── DeckNewPage.tsx           Create / import a deck
        │   └── DeckEditorPage.tsx        Edit deck contents and theme
        ├── components/
        │   ├── Layout.tsx, Header.tsx, Footer.tsx, MobileTabBar.tsx
        │   ├── UploadPanel.tsx, ImportSheet.tsx
        │   ├── BinderTabs.tsx, BinderView.tsx, BinderListView.tsx
        │   ├── BinderEditor.tsx          OR-grouped rule editor
        │   ├── BinderExportDialog.tsx, BinderPickerSheet.tsx, BinderPagePreview.tsx
        │   ├── BinderCardEditor.tsx      Edit card details within a binder
        │   ├── PageGrid.tsx, CardSlot.tsx, CardPreview.tsx, CardPreviewContext.ts
        │   ├── CardListTable.tsx, CardEditDialog.tsx, CardRowMenu.tsx
        │   ├── CardPickerSheet.tsx, AddCardSheet.tsx, AddToBinderSheet.tsx
        │   ├── StatsBar.tsx, FilterPopover.tsx, SearchPill.tsx, ViewModeToggle.tsx
        │   ├── SettingsMenu.tsx, ManaCost.tsx, DeckBadge.tsx
        │   ├── Modal.tsx, SelectMenu.tsx, ConfirmDialog.tsx, ToastViewport.tsx
        │   ├── PriceFreshnessLine.tsx, Legend.tsx, ErrorBoundary.tsx
        │   └── deck/
        │       ├── CommanderSearch.tsx, CardSearchPanel.tsx
        │       ├── DeckDisplay.tsx, DeckCustomizer.tsx
        │       └── ImportDeckDialog.tsx, ThemePicker.tsx
        ├── deck-builder/                 EDHREC-powered deck generation
        │   ├── hooks/useUserLists.ts
        │   ├── lib/                      commanderTheme, partnerUtils, region, utils, constants/
        │   ├── services/
        │   │   ├── deckBuilder/          Generator, analyzer, enricher, bracket estimator, curve utils
        │   │   ├── edhrec/               EDHREC client and theme mapper
        │   │   ├── scryfall/             Scryfall search client
        │   │   └── tagger/               Card role tagger client
        │   ├── store/index.ts            Deck builder Zustand store
        │   └── types/index.ts
        ├── lib/
        │   ├── rules.ts                  Rule-matching engine (OR groups)
        │   ├── materialize.ts            Routes cards into binders + uncategorized
        │   ├── sorting.ts                Multi-level sort
        │   ├── allocations.ts            Deck-copy to collection-card allocation
        │   ├── sections.ts               Deck section parsing (commander / companion / sideboard)
        │   ├── colors.ts, card-types.ts, foil-style.ts, slot-text.ts
        │   ├── samples.ts               Sample collection for first-run
        │   ├── themes.ts                Guild themes
        │   ├── api.ts                    Backend client
        │   ├── auth-api.ts              Auth API client
        │   ├── sync.ts                  Server sync (pull/push with optimistic concurrency)
        │   ├── scryfall-to-enriched.ts  Scryfall response to EnrichedCard transform
        │   ├── local-cards.ts           IndexedDB persistence (idb)
        │   ├── backup.ts               Export / restore local state
        │   ├── scryfall-catalog.ts      Catalog autocomplete
        │   ├── format-time.ts
        │   └── use-*.ts                 Hooks (debounce, holographic, swipe, scroll lock, centered-slide, confirm)
        ├── store/
        │   ├── auth.ts                  Authentication state
        │   ├── collection.ts            Cards + binders
        │   ├── decks.ts                 Decks (persisted)
        │   ├── theme.ts                 Active guild theme
        │   └── toasts.ts               Toast queue
        ├── styles/
        │   ├── global.css
        │   ├── themes.css               Guild theme CSS variables
        │   └── deck-builder.css
        └── types/index.ts
```

## API

All `/api/*` endpoints sit behind helmet and per-endpoint rate limiters.

| Method   | Path                         | Purpose                                                                                          |
| -------- | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET`    | `/health`                    | Liveness + cache stats                                                                           |
| `GET`    | `/api/sets`                  | Cached Scryfall set list (1h browser cache)                                                      |
| `POST`   | `/api/import`                | Multipart `file` or JSON `{ text }`. Returns enriched cards, format detection, unresolved names  |
| `POST`   | `/api/import-deck`           | Same shape as `/api/import` but parses commander / companion / sideboard sections                |
| `GET`    | `/api/cards/:name/printings` | All printings of a card (for finish / treatment swaps)                                           |
| `POST`   | `/api/refresh-prices`        | Refresh prices for a list of cards without re-importing                                          |
| `POST`   | `/api/auth/register`         | Create a user. `{ username, password }` → session cookie. 5/hr per IP                            |
| `POST`   | `/api/auth/login`            | Sign in. `{ username, password }` → session cookie. 10 / 15 min per IP                           |
| `POST`   | `/api/auth/logout`           | Clears the session cookie                                                                        |
| `GET`    | `/api/auth/me`               | Returns the current user, or 401                                                                 |
| `DELETE` | `/api/auth/me`               | Permanently deletes the account and all synced data (auth required)                              |
| `GET`    | `/api/sync`                  | Returns the user's collection / binders / decks snapshot + version (auth required)               |
| `PUT`    | `/api/sync`                  | Pushes a new snapshot. `{ collection, binders, decks, baseVersion }`. 409 on stale `baseVersion` |

`EnrichedCard` includes the standard Scryfall fields plus `importId` (per-batch tag), `finishes`, `layout`, `borderColor`, `legalities`, `oracleText`, `frameEffects`, `fullArt`, `imageNormalBack` (DFC reverse), `manaCost`, and `promoTypes`.

## Tweakables

- Cache TTL — `TTL_MS` in [backend/src/cache.ts](backend/src/cache.ts)
- Scryfall batch size and rate limit — top of [backend/src/scryfall.ts](backend/src/scryfall.ts)
- Rate limits — `importLimiter` and `priceLimiter` in [backend/src/server.ts](backend/src/server.ts)
- Default sorts for new binders — `NEW_BINDER_DEFAULT_SORTS` in [frontend/src/lib/sorting.ts](frontend/src/lib/sorting.ts)
- Default EDHREC top-N — `DEFAULT_EDHREC_TOP_N` in [frontend/src/components/BinderEditor.tsx](frontend/src/components/BinderEditor.tsx)
- Backend port — `PORT` env var (default `3737`)
- SQLite location — `DB_PATH` env var (default `backend/data/scryfall-cache.db`; the Docker image mounts a `binder-data` volume at `/data`)

## Scripts

From the repo root:

```bash
npm run db:up             # start dev Postgres (docker-compose.dev.yml)
npm run db:down           # stop dev Postgres
npm run dev               # backend + frontend together
npm test                  # vitest in both workspaces
npm run typecheck         # tsc --noEmit in both
npm run build             # production build for both
npm run lint              # eslint + stylelint
npm run lint:fix
npm run format            # prettier --write
npm run format:check
```

Per workspace, both `frontend` and `backend` also expose `test:watch` and `test:coverage`. CI enforces an 80% coverage floor on `lib/` and parser modules.

`husky` + `lint-staged` run prettier on staged files before commit.

## Contributing

Issues and pull requests welcome. Especially helpful:

- Sample CSV exports from collection tools that do not import cleanly (open an issue with a small redacted sample).
- Bug reports for cards that fail to resolve via Scryfall — include the card name, set, collector number, and the source format.
- New rule fields, sort options, or import formats.

To add a test, drop a `*.test.ts` (or `*.test.tsx`) file next to the module — Vitest picks it up automatically. CI runs lint, typecheck, tests, and coverage on every push and pull request via GitHub Actions, and Dependabot keeps deps current.

## License

MIT. See [LICENSE](./LICENSE).

This tool is unofficial and not affiliated with Wizards of the Coast, Scryfall, or ManaBox. Magic: The Gathering and all related assets are property of Wizards of the Coast LLC.
