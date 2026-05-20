# SpellControl

Plan your physical Magic: The Gathering binders. Import a collection export from any popular tool, define binders with custom rules, build decks across multiple MTG formats (Commander, Brawl, Standard, Pauper), and sync everything across devices.

## What you can do

- **Import a collection** from ManaBox / Moxfield / Archidekt / Deckbox / TCGplayer / Cardsphere / MTGA / plain text. Format is auto-detected.
- **Define binders** as a set of OR-grouped match rules plus a sort spec and pocket size (4, 9, 12, or 18). Drag to reorder binders and control which gets first dibs on each card.
- **View binders** as physical pages or as a flat list, with a card preview pane and per-binder export.
- **Build decks** across multiple formats — Commander, Brawl, Standard, and Pauper. Each format enforces its own rules: singleton vs 4-of, commander requirement, sideboard support, and legality validation against Scryfall data.
- **Generate Commander decks** from EDHREC data — pick a commander, choose themes, set a bracket level, and get a full 100-card deck with mana curve balancing and role targeting.
- **Build constructed decks manually** — 60-card Standard or Pauper decks with 15-card sideboards. Cards flagged inline when not legal in the chosen format.
- **Browse your collection** in a sortable, filterable table with breakdowns by color, type, rarity, and price.
- **Sign in and sync** — create an account to store your collection, binders, and decks on the server. Changes push automatically and pull on login.
- **Skin the app** with a guild theme — accents, surfaces, and warning / error colors all re-tint per theme.

## How it works

1. **Import** — drop a CSV / TSV / text file or paste a list. The backend resolves every row against a cached Scryfall mirror and returns enriched cards.
2. **Sign in** — create an account or log in. All state is tied to your account and syncs across devices.
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

- **Legalities** — IS / IS NOT against format-legal status (commander, modern, etc).
- **Color identity** — IS / IS NOT. `M` matches any multicolor.
- **Rarity** — IS / IS NOT.
- **CMC** — min / max mana value.
- **Mana cost** — exact match on the normalized cost string.
- **Type line** — IS / IS NOT substring chips against the Scryfall type line.
- **Oracle text** — IS / IS NOT substring chips against rules text.
- **Commander** — Any / Is / Is not. _Is_ matches commander-eligible cards: legendary creatures, plus cards whose text says "can be your commander" (planeswalker-commanders), that are legal in the Commander format. _Is not_ matches everything else.
- **Sets** — multi-select from sets in your collection.
- **Price** — min / max in USD.
- **Finishes** — IS / IS NOT (nonfoil, foil, etched).
- **Layout** — IS / IS NOT (normal, modal_dfc, adventure, etc).
- **Name contains** — case-insensitive substring.
- **Treatment** — IS / IS NOT frame effects (showcase, extended, fullart, etc).
- **Border** — IS / IS NOT border color.
- **EDHREC popularity** — top N most popular EDH cards from Scryfall's `edhrec_rank`.

## Where data lives

- **User accounts** — Postgres on the backend (`users` table, bcrypt password hashes with 12 salt rounds, session JWTs in httpOnly cookies).
- **Synced state (collection, binders, decks)** — Postgres on the backend (`user_data` table, JSONB columns, optimistic-concurrency `version`). Pulled on login, debounced-pushed on every change.
- **Local cache** — `localStorage` (binders, decks, theme) and `IndexedDB` (collection cards) in the browser. Hydrated from the server snapshot after login; wiped on sign-out.
- **Scryfall card data** — cached server-side in SQLite for 7 days. Shared across all users of the backend.

## Setup

### Prerequisites

- **Node.js 22 or newer** (the version is pinned in `.nvmrc`; CI and the Docker images both use it)
- A C++ toolchain (for `better-sqlite3`):
  - macOS: `xcode-select --install`
  - Linux: `sudo apt install build-essential python3`
  - Windows: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload

### Local development

```bash
npm install                              # root dev tools (concurrently, husky, prettier)
npm install --prefix packages/game-core  # shared reducer — installs + builds its dist
npm install --prefix frontend            # resolves the @spellcontrol/game-core file: dep
npm install --prefix backend             # resolves the @spellcontrol/game-core file: dep
npm run db:up                            # dev Postgres on :5432 (docker-compose.dev.yml)
npm run dev                              # backend on :3737, frontend on :5173
```

The backend reads its dev env from `backend/.env` (gitignored). Create it once with the matching dev Postgres creds:

```bash
cat > backend/.env <<'EOF'
DATABASE_URL=postgres://mtguser:mtgpassword@localhost:5432/spellcontrol
JWT_SECRET=dev-jwt-secret-please-change-in-prod
NODE_ENV=development
EOF
```

(These match the credentials in `docker-compose.dev.yml`. Don't reuse these values in production — production env lives in the root `.env` next to `docker-compose.yml`; see `.env.example`.)

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

The backend container is no longer published to the host. The frontend container's nginx proxies `/api/` to it on the docker-compose network, so a single `spellcontrol.example.com` reverse-proxy entry is enough.

Backend and frontend images are tagged `ghcr.io/georgepapagapitos/spellcontrol-{backend,frontend}:latest` and built by GitHub Actions on every push to `main`. Watchtower labels are set, so a Watchtower instance will auto-update both containers.

#### Dev database

For local development, `docker-compose.dev.yml` runs just the Postgres container. Use `npm run db:up` and `npm run db:down` to start and stop it.

#### Postgres backups

The data lives in the `spellcontrol-postgres` named volume. A nightly logical backup is recommended:

```bash
docker exec spellcontrol-postgres pg_dump -U spellcontrol spellcontrol | gzip > /backups/spellcontrol-$(date +%F).sql.gz
```

Wire that into cron and rotate the files. Restore with `gunzip -c file.sql.gz | docker exec -i spellcontrol-postgres psql -U spellcontrol spellcontrol`.

### Required environment

The backend reads:

- `DATABASE_URL` — Postgres connection string. Required.
- `JWT_SECRET` — 16+ character random string used to sign session tokens. Required. Rotating it invalidates every session.
- `ADMIN_USERNAMES` — optional, comma-separated list of usernames that should hold the `admin` role. On boot, any matching existing user is promoted (additively — names removed from the list keep their role). New registrations matching this list are promoted at insert time. Admins see an extra "Admin — manage users" card on the Settings page, where they can list users, see per-account storage size, and delete accounts.
- `OFFLINE_BULK_DISABLED` — optional. Set to `1` to disable the daily Scryfall oracle bulk refresh. The bulk itself is built lazily on the first request to `/api/offline/oracle-cards`; this flag opts out of the once-a-day rebuild thereafter (the cached payload keeps serving). Useful on tightly memory-constrained hosts where the periodic ~1GB peak isn't worth it.
- `COMBOS_INGEST_DISABLED` — optional. Set to `1` to skip the nightly Commander Spellbook ingest. The existing dataset keeps serving.
- `PORT` (default `3737`), `DB_PATH` (default `backend/data/scryfall-cache.db`).

## Architecture

The repo is a monorepo with three packages: `backend/`, `frontend/`, and the shared `packages/game-core/`.

**Backend** — Node + Express 5 + TypeScript. Postgres (via Drizzle) stores user accounts and synced state. A SQLite cache (via better-sqlite3) holds Scryfall card data with a 7-day TTL. Format-specific parsers in `src/parsers/` handle import detection and normalization.

**Frontend** — React 18 + Vite + TypeScript + Zustand + react-router-dom 7. Collection and binder state lives in IndexedDB and localStorage, synced to the server on change. The `deck-builder/` subsystem handles EDHREC-powered deck generation with its own services, store, and types. Plain CSS with guild-themed custom properties for re-skinning.

**game-core** (`packages/game-core/`) — a zero-dependency, isomorphic package owning the multiplayer game-state reducer (`applyAction`, `createGameState`, loss/win logic, `GameState`/`GameAction` types). It is the single source of truth: the backend runs it for authoritative online sessions and the frontend runs it for local + optimistic play. Both consume it as a `file:` dependency (`@spellcontrol/game-core`) — `backend → game-core ← frontend`, with game-core a leaf. It builds a dual CJS (backend) + ESM (frontend bundle) output with shared types, has its own test suite (80% coverage gate), and there is no second copy to keep in lockstep.

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

`EnrichedCard` combines import-row data (`copyId`, `name`, `setCode`, `collectorNumber`, `rarity`, `scryfallId`, `purchasePrice`, `finish`, `sourceCategory`, `sourceFormat`) with optional per-copy fields (`condition`, `language`, `altered`, `proxy`, `misprint`) and Scryfall enrichment (`cmc`, `typeLine`, `colorIdentity`, `colors`, `edhrecRank`, images, `finishes`, `layout`, `borderColor`, `legalities`, `oracleText`, `frameEffects`, `fullArt`, `manaCost`, `promoTypes`, `imageNormalBack` for DFCs).

## Tweakables

- Cache TTL — `TTL_MS` in [backend/src/cache.ts](backend/src/cache.ts)
- Scryfall batch size and rate limit — top of [backend/src/scryfall.ts](backend/src/scryfall.ts)
- Rate limits — `importLimiter` and `priceLimiter` in [backend/src/server.ts](backend/src/server.ts)
- Default sorts for new binders — `NEW_BINDER_DEFAULT_SORTS` in [frontend/src/lib/sorting.ts](frontend/src/lib/sorting.ts)
- Default EDHREC top-N — `DEFAULT_EDHREC_TOP_N` in [frontend/src/components/BinderEditor.tsx](frontend/src/components/BinderEditor.tsx)
- Backend port — `PORT` env var (default `3737`)
- SQLite location — `DB_PATH` env var (default `backend/data/scryfall-cache.db`; the Docker image mounts a `spellcontrol-data` volume at `/data`)

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

Per workspace, both `frontend` and `backend` also expose `test:watch` and `test:coverage`. CI enforces an 80% coverage floor on `lib/` and parser modules. The shared `packages/game-core` package is built and tested independently (its own `npm test` / `test:coverage`, run as a dedicated CI job and built before the consumer jobs); the root `npm test` covers `frontend` + `backend` only.

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
