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

### Native app (Android)

The Android app is a [Capacitor](https://capacitorjs.com/) shell around the same `frontend` bundle — there is no separate native UI. The native project lives in `frontend/android/`; building it needs the Android SDK and a JDK (the project builds with JDK 21) with `ANDROID_HOME`, `adb`, and `gradlew` available.

Which backend the installed app talks to is baked in at build time via `VITE_API_BASE_URL`:

| Build                     | `VITE_API_BASE_URL`            | Backend       | Database           |
| ------------------------- | ------------------------------ | ------------- | ------------------ |
| Native dev                | `http://localhost:3737`        | local backend | local dev Postgres |
| Device check against prod | `https://api.spellcontrol.com` | production    | production (Neon)  |

For everyday work, **build against the local backend** so the device runs on your dev stack and never touches production data:

```bash
# Local stack already running (npm run db:up + npm run dev).
# Forward the dev ports to the USB-connected device (re-run after every replug):
adb reverse tcp:3737 tcp:3737
adb reverse tcp:5173 tcp:5173

# Build the web bundle, sync it into the native project, build + install:
cd frontend
VITE_API_BASE_URL=http://localhost:3737 npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Only build with `VITE_API_BASE_URL=https://api.spellcontrol.com` to validate a real device against production — that build reads and writes the live database.

**Service-worker gotcha:** the frontend is a PWA, so its service worker precaches the app shell in the WebView's Cache Storage. That cache survives `adb install -r` (a reinstall keeps app data), so a freshly installed APK can keep serving the _old_ bundle. After installing a new build, clear the app's data once — `adb shell pm clear com.spellcontrol.app`, or Settings → Apps → SpellControl → Storage → Clear data — then relaunch. The local cache (decks/collection) is a write-through cache and the server is the source of truth, so it re-downloads on next sign-in.

### Deployment

Production runs on [Fly.io](https://fly.io) — see `fly.toml` and `.github/workflows/fly-deploy.yml`. A push to `main` triggers CI; on green CI the fly-deploy workflow runs `flyctl deploy --remote-only`, which builds the image from `backend/Dockerfile` and ships it to the `spellcontrol-api` app. The backend container serves both `/api` and the SPA — the Dockerfile builds the frontend and copies `frontend/dist` into `backend/public` — so prod is a single origin.

Environment is managed as Fly secrets (`fly secrets set FOO=bar`). The production Postgres is Neon (managed, with its own backups); the dev Postgres below is local-only.

### Local Postgres

For local development, `docker-compose.dev.yml` runs just the Postgres container. Use `npm run db:up` and `npm run db:down` to start and stop it.

### Offline mode

Card data is always-on. After sign-in, the frontend silently downloads a slim Scryfall oracle bulk (~7 MB gzipped, ~35k cards) and the Commander Spellbook combo dataset into IndexedDB. Card search, deck generation, and combo matching prefer the local copy whenever it's populated — the live Scryfall API is the fallback, not the primary. There is no toggle. The Settings page shows a one-line status (`35,329 cards · 7.3 MB · updated 2 days ago`) and an escape-hatch "Clear cached card data" button; otherwise the user shouldn't have to think about it.

How the freshness loop works:

- The backend builds the bulk lazily on the first request to `/api/offline/oracle-cards` and persists the gzipped blob to `/data` so container recreates short-circuit on disk. A daily refresh runs only while a payload is in memory — never on a fresh boot.
- The frontend asks the browser for `navigator.storage.persist()` so the cached blob isn't first-in-line for eviction. It also checks the server manifest at most once per 24h (localStorage timestamp); if the version differs, it re-downloads.
- iOS Safari purges IndexedDB after ~14 days of inactivity. The frontend detects this on the next authed mount (manifest survives in zustand but `cardCount === 0`) and silently re-downloads — the user sees no error, just a brief warm-up before searches are back to local-speed. Watch the browser console for `[offline] cache miss …` if you're debugging.

Tweak `OFFLINE_BULK_DISABLED=1` on the backend (see "Required environment") to opt out of the daily refresh on a tightly memory-constrained host.

### Required environment

The backend reads:

- `DATABASE_URL` — Postgres connection string. Required.
- `JWT_SECRET` — 16+ character random string used to sign session tokens. Required. Rotating it invalidates every session.
- `ADMIN_USERNAMES` — optional, comma-separated list of usernames that should hold the `admin` role. On boot, any matching existing user is promoted (additively — names removed from the list keep their role). New registrations matching this list are promoted at insert time. Admins see an extra "Admin — manage users" card on the Settings page, where they can list users, see per-account storage size, and delete accounts.
- `OFFLINE_BULK_DISABLED` — optional. Set to `1` to disable the daily Scryfall oracle bulk refresh. The bulk itself is built lazily on the first request to `/api/offline/oracle-cards`; this flag opts out of the once-a-day rebuild thereafter (the cached payload keeps serving). Useful on tightly memory-constrained hosts where the periodic ~1GB peak isn't worth it.
- `COMBOS_INGEST_DISABLED` — optional. Set to `1` to skip the nightly Commander Spellbook ingest. The existing dataset keeps serving.
- `SCRYFALL_BULK_INGEST_DISABLED` — optional. Set to `1` to skip the daily Scryfall `default_cards` bulk ingest into the SQLite card cache. With it disabled, imports still resolve — they just fall back to the live Scryfall API for cards not already cached on demand (the pre-ingest behavior). The ingest pre-populates the `cards` + `card_lookups` tables so re-importing a collection resolves locally with no network calls; it streams the dump (memory stays flat) and a meta file (`scryfall-bulk.meta.json`, co-located with `DB_PATH`) skips a re-pull within 20h of the last run.
- `PORT` (default `3737`), `DB_PATH` (default `backend/data/scryfall-cache.db`).
- `OFFLINE_DATA_DIR` — optional. Directory where the persisted Scryfall oracle bulk (`offline-oracle.json.gz` + `offline-oracle.meta.json`) is written and read. Defaults to `dirname(DB_PATH)` so the bulk co-locates with the SQLite cache (a single `/data` mount survives container recreates). Set explicitly only for custom layouts.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_WEB_REDIRECT_URI`, `OAUTH_NATIVE_REDIRECT_URI` — optional. Enable "Continue with Google" SSO when all four are set; with any unset, the `/api/auth/google*` routes return 503 and the frontend hides the button. Create an OAuth 2.0 Client (Web application type) in the Google Cloud Console and register the redirect URIs you use. See `.env.example` for the values you'll want in dev vs prod.
- `ANDROID_APP_FINGERPRINTS` — optional. Comma-separated SHA-256 signing-cert fingerprints (debug + release; case- and colon-insensitive) for the Android APK. Enables `/.well-known/assetlinks.json`, which Android verifies so the App Link intent filter can intercept `https://spellcontrol.com/oauth/callback` URLs and hand the Google sign-in return to the installed app instead of leaving it stuck in the browser. With this unset the endpoint returns 404 and the native flow falls back to the legacy `spellcontrol://oauth/callback` custom scheme (works in Chrome only). Pull fingerprints with `keytool -list -v -keystore … -alias …` and set as a Fly secret.
- `APP_HTTPS_DEEPLINK_BASE` — optional. Origin used to build the native OAuth callback URL; defaults to `https://spellcontrol.com`. Override for a staging deployment that hosts its own `assetlinks.json` and a matching App Link intent filter.

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
- Scryfall batch size, batch concurrency, and inter-batch delay — top of [backend/src/scryfall.ts](backend/src/scryfall.ts) (`BATCH_SIZE`, `BATCH_CONCURRENCY`, `REQUEST_DELAY_MS`)
- Import chunk size and client upload concurrency — top of [frontend/src/lib/api.ts](frontend/src/lib/api.ts) (`IMPORT_CHUNK_SIZE`, `IMPORT_CHUNK_CONCURRENCY`)
- Scryfall bulk ingest flush size — `FLUSH_AT` in [backend/src/scryfall-bulk.ts](backend/src/scryfall-bulk.ts)
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

## Tests & CI

To add a test, drop a `*.test.ts` (or `*.test.tsx`) file next to the module — Vitest picks it up automatically. CI runs lint, typecheck, tests, and coverage on every push and pull request via GitHub Actions, and Dependabot keeps deps current.

## License

Proprietary — all rights reserved. See [LICENSE](./LICENSE). No permission is granted to copy, modify, redistribute, or resell this software.

## Legal & attribution

SpellControl is unofficial Fan Content permitted under the [Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.

Card data and images are provided by [Scryfall](https://scryfall.com). SpellControl is not affiliated with Scryfall, ManaBox, Moxfield, Archidekt, Deckbox, TCGplayer, or Cardsphere.
