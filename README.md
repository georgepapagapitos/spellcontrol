# SpellControl

Plan your Magic: The Gathering collection. Import a collection export from any popular tool, sort it into rule-based binders, build and tune decks across eight formats (Commander, Brawl, Standard, Pauper, Modern, Pioneer, Legacy, Vintage), play and track multiplayer games at the table or online, and trade with friends — all synced across your devices.

## What you can do

- **Import a collection** from ManaBox / Moxfield / Archidekt / Deckbox / TCGplayer / Cardsphere / MTGA / plain text. Format is auto-detected.
- **Define binders** as a set of OR-grouped match rules plus a sort spec and pocket size (4, 9, 12, or 18). Drag to reorder binders and control which gets first dibs on each card.
- **View binders** as physical pages or as a flat list, with a card preview pane and per-binder export.
- **Build decks** across eight formats — Commander, Brawl, Standard, Pauper, Modern, Pioneer, Legacy, and Vintage. Each format enforces its own rules: singleton vs 4-of, commander requirement, sideboard support, and legality validation against Scryfall data.
- **Generate Commander decks** from EDHREC data — pick a commander, choose themes, set a power bracket, and get a full 100-card deck with mana curve balancing and role targeting.
- **Tune any deck with the Coach** — a ranked list of moves (add, cut, swap for a card you already own), each with a plain-English reason, backed by combo, win-condition, and synergy analysis plus power-bracket fit.
- **Build constructed decks manually** — 60-card decks (Standard, Pauper, Modern, Pioneer, Legacy, Vintage) with 15-card sideboards. Cards flagged inline when not legal in the chosen format.
- **Build a cube** — a draft-ready singleton cube from cards you own, import one from CubeCobra to see how much of it you own, or build one with friends.
- **Playtest any deck** — goldfish on a full battlefield board: draw, mulligan, tap, move cards between zones, make tokens.
- **Play at the table** — a shared life tracker (life, commander damage, step tracking) for local games, or host an online game with a join code: every player syncs live, opens their own board, points at cards, and chats.
- **Run game nights** — a recurring series with invite links; results land in your game history.
- **Play with friends** — friend requests and per-friend hubs, pods for your regular table, and trades that settle both collections when an offer is accepted. A friend request, trade offer or game-night invite also emails you when your account has a verified email (switch it off under Settings → Sign-in methods), unseen badges agree across devices, and a want-list card that drops under your target price raises an alert.
- **Publish and discover decks** — share a deck at a public link, browse and save other people's public decks, and keep a public profile.
- **Find cards** — card search with owned-copy badges, browse-by-tag discovery over Scryfall's oracle-tag corpus, and a combo finder over what you own.
- **Look up rules** — a built-in Comprehensive Rules reference: keywords, glossary, and rule-number search at `/rules` (header, ⌘K, and You › Help), plus a quick-look sheet from the Play page and the in-game menu. With AI on, the same page answers rules questions with citations.
- **Scan paper cards** (Android app) — add cards to the collection by pointing the phone camera at them.
- **Browse your collection** in a sortable, filterable table with breakdowns by color, type, rarity, and price.
- **Export it all** — the collection (or one binder) as a one-row-per-copy CSV for SpellControl/ManaBox, Moxfield or Archidekt, or an Arena text list, a JSON backup that carries binders, lists and every deck, decks as Arena / Moxfield / MTGO `.dek` text, and a printable checklist of any deck or binder.
- **Sign in and sync** — create an account to store your collection, binders, and decks on the server. Changes push automatically and pull on login. Add a verified email and you can reset a forgotten password, set a password on a Google-only account, or change either from Settings.
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
- **Oracle tags** — IS / IS NOT against Scryfall's curated card tags (otags) — pick a concept like _Mana rock_ or _Removal_ from a closed list. More precise than oracle text for semantic concepts (e.g. _Mana rock_ won't mismatch "addition" the way text "add" does). Resolved offline from the bundled tagger snapshot.
- **Commander** — Any / Is / Is not. _Is_ matches commander-eligible cards: legendary creatures, plus cards whose text says "can be your commander" (planeswalker-commanders), that are legal in the Commander format. _Is not_ matches everything else.
- **Sets** — multi-select from sets in your collection.
- **Price** — min / max in your display currency (Settings → Price currency: USD via TCGplayer or EUR via Cardmarket).
- **Finishes** — IS / IS NOT (nonfoil, foil, etched).
- **Layout** — IS / IS NOT (normal, modal_dfc, adventure, etc).
- **Name contains** — case-insensitive substring.
- **Treatment** — IS / IS NOT frame effects (showcase, extended, fullart, etc).
- **Border** — IS / IS NOT border color.
- **EDHREC popularity** — top N most popular EDH cards from Scryfall's `edhrec_rank`.

## Where data lives

- **User accounts** — Postgres on the backend (`users` table, bcrypt password hashes with 12 salt rounds, session JWTs in httpOnly cookies). An email is stored only once its verification link is clicked; password-reset and email-verification links are single-use tokens stored as SHA-256 hashes in `auth_tokens` (reset links live 1 hour, verification links 24). A daily retention sweep (`backend/src/retention.ts`) prunes AI readings older than a year, analytics count rows older than 400 days, revoked share links older than 30 days that carry no feedback, and game sessions idle for a day.
- **Synced state (collection, binders, decks)** — Postgres on the backend, stored per row with a monotonic `rev`. The client syncs **deltas**: a durable mutation queue debounced-pushes per-row upserts/deletes (`POST /api/sync`), and a paged delta pull (`GET /api/sync?since=<cursor>`) applies remote changes in rev order. Conflict resolution is **last-write-wins per row** — no base-version check, no 409.
- **Local cache** — `IndexedDB` (collection cards, decks, plus a per-row entity store and mutation queue) and `localStorage` (theme and lighter state) in the browser. Hydrated from the server after login; wiped on sign-out.
- **Scryfall card data** — cached server-side in SQLite for 7 days. Shared across all users of the backend.
- **Games & social** — online game sessions, game-night series, and finished-game results live in Postgres (`game_sessions`, `game_night_series`, `game_results`), as do friends, trades, and pods. `game_results` holds one row per finished game in either mode: the server writes an online game's row when the session finishes, and the device that tracked a local game posts its row when the game ends (credited seats must be the recorder or an accepted friend). Every stats surface (history, deck records, friends leaderboard, head-to-head, pods) reads that one table and can filter by mode. Live online games run the shared `game-core` reducer: the backend applies actions authoritatively, clients apply them optimistically.

## Setup

### Prerequisites

- **Node.js 22 or newer** (the version is pinned in `.nvmrc`; CI and the Docker images both use it)
- A C++ toolchain (for `better-sqlite3`):
  - macOS: `xcode-select --install`
  - Linux: `sudo apt install build-essential python3`
  - Windows: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload

### Local development

```bash
npm install                                  # root dev tools (concurrently, husky, prettier)
npm install --prefix packages/game-core      # shared reducer — installs + builds its dist
npm install --prefix packages/binder-routing # shared binder routing engine — installs + builds its dist
npm install --prefix packages/deck-metrics   # shared bracket estimator — installs + builds its dist
npm install --prefix frontend                # resolves the @spellcontrol/* file: deps
npm install --prefix backend                 # resolves the @spellcontrol/* file: deps
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

| Build                     | `VITE_API_BASE_URL`        | Backend       | Database           |
| ------------------------- | -------------------------- | ------------- | ------------------ |
| Native dev                | `http://localhost:3737`    | local backend | local dev Postgres |
| Device check against prod | `https://spellcontrol.com` | production    | production (Neon)  |

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

Only build with `VITE_API_BASE_URL=https://spellcontrol.com` to validate a real device against production — that build reads and writes the live database.

**Stale-bundle gotcha:** the frontend is **not** a PWA — the service worker was retired (#482); the web app is a plain SPA and `register-pwa.ts` only _unregisters_ any SW a prior build left behind. But a WebView can still hold an old build's cached app shell in Cache Storage (or a lingering pre-#482 SW), and that cache survives `adb install -r` (a reinstall keeps app data), so a freshly installed APK can keep serving the _old_ bundle. After installing a new build, clear the app's data once — `adb shell pm clear com.spellcontrol.app`, or Settings → Apps → SpellControl → Storage → Clear data — then relaunch. The local cache (decks/collection) is a write-through cache and the server is the source of truth, so it re-downloads on next sign-in.

### Deployment

Production runs on [Fly.io](https://fly.io) — see `fly.toml` and `.github/workflows/fly-deploy.yml`. A push to `main` triggers CI; on green CI the fly-deploy workflow runs `flyctl deploy --remote-only`, which builds the image from `backend/Dockerfile` and ships it to the `spellcontrol-api` app. The backend container serves both `/api` and the SPA — the Dockerfile builds the frontend and copies `frontend/dist` into `backend/public` — so prod is a single origin.

Environment is managed as Fly secrets (`fly secrets set FOO=bar`). The production Postgres is Neon (managed, with its own backups); the dev Postgres below is local-only.

### Local Postgres

For local development, `docker-compose.dev.yml` runs just the Postgres container. Use `npm run db:up` and `npm run db:down` to start and stop it.

### Offline mode

Card data is always-on. After sign-in, the frontend silently downloads a slim Scryfall oracle bulk (~7 MB gzipped, ~35k cards) and the Commander Spellbook combo dataset into IndexedDB. Card search, deck generation, and combo matching prefer the local copy whenever it's populated — the live Scryfall API is the fallback, not the primary. The combo dataset (~107k rows, 163 MB decoded) is imported in a Web Worker and matched through a compact index (`frontend/src/lib/offline/combo-index.ts`: ids, interned card ids, popularity, legality bits — ~5 MB, one IndexedDB row, kept in memory for the session), so a deck view never reads the full rows back; only the combos it shows are hydrated. There is no toggle. The Settings page shows a one-line status (`35,329 cards · 7.3 MB · updated 2 days ago`) and an escape-hatch "Clear cached card data" button; otherwise the user shouldn't have to think about it.

How the freshness loop works:

- The backend builds the bulk lazily on the first request to `/api/offline/oracle-cards` and persists the gzipped blob to `/data` so container recreates short-circuit on disk. A daily refresh runs only while a payload is in memory — never on a fresh boot.
- The frontend asks the browser for `navigator.storage.persist()` so the cached blob isn't first-in-line for eviction. It also checks the server manifest at most once per 24h (localStorage timestamp); if the version differs, it re-downloads.
- iOS Safari purges IndexedDB after ~14 days of inactivity. The frontend detects this on the next authed mount (manifest survives in zustand but `cardCount === 0`) and silently re-downloads — the user sees no error, just a brief warm-up before searches are back to local-speed. Watch the browser console for `[offline] cache miss …` if you're debugging.

Tweak `OFFLINE_BULK_DISABLED=1` on the backend (see "Required environment") to opt out of the daily refresh on a tightly memory-constrained host.

### Required environment

The backend reads:

- `DATABASE_URL` — Postgres connection string. Required.
- `JWT_SECRET` — 16+ character random string used to sign session tokens. Required. Rotating it invalidates every session.
- `ADMIN_USERNAMES` — optional, comma-separated list of usernames that should hold the `admin` role. On boot, any matching existing user is promoted (additively — names removed from the list keep their role). New registrations matching this list are promoted at insert time. Admins see an extra "Admin — manage users" card on the Settings page, where they can list users, see per-account storage size, delete accounts, grant individual accounts the AI features (with an optional per-user daily limit) while `AI_PUBLIC` is unset, and read an estimated AI spend (today / 7 days / 30 days, plus a 30-day per-user column).
- `OFFLINE_BULK_DISABLED` — optional. Set to `1` to disable the daily Scryfall oracle bulk refresh. The bulk itself is built lazily on the first request to `/api/offline/oracle-cards`; this flag opts out of the once-a-day rebuild thereafter (the cached payload keeps serving). Useful on tightly memory-constrained hosts where the periodic ~1GB peak isn't worth it.
- `COMBOS_INGEST_DISABLED` — optional. Set to `1` to skip the nightly Commander Spellbook ingest. The existing dataset keeps serving.
- `SCRYFALL_BULK_INGEST_DISABLED` — optional. Set to `1` to skip the daily Scryfall `default_cards` bulk ingest into the SQLite card cache. With it disabled, imports still resolve — they just fall back to the live Scryfall API for cards not already cached on demand (the pre-ingest behavior). The ingest pre-populates the `cards` + `card_lookups` tables so re-importing a collection resolves locally with no network calls; it streams the dump (memory stays flat) and a meta file (`scryfall-bulk.meta.json`, co-located with `DB_PATH`) skips a re-pull within 20h of the last run.
- `HEALTHCHECKS_PING_URL` — optional. A healthchecks.io ping URL (`https://hc-ping.com/<uuid>`). When set, the backend probes the public `https://spellcontrol.com/health` every 5 minutes and pings the URL on a pass or `<url>/fail` on a failure, so the (passive) monitor alerts both when the site answers badly and when the machine stops pinging altogether. Create the check with a 5-minute period and 5-minute grace, then `flyctl secrets set HEALTHCHECKS_PING_URL=… --app spellcontrol-api`. `HEALTHCHECKS_PROBE_ORIGIN` overrides the probed origin (point a local run at a bogus host to watch `/fail` land); `UPTIME_HEARTBEAT_DISABLED=1` switches the loop off. The same tick also reports a failure (with the count in the ping body) when the first-party beacon has counted more than `ERROR_BURST_ALERT` client errors (default `25`, `0` disables) in the last 15 minutes, so a crashing bundle behind a healthy shell pages the same way an outage does. The beacon itself (`POST /api/events`) counts usage events, uncaught client errors (scrubbed message + script frame, one row per distinct pair per day) and Core Web Vitals bands; all three are aggregate rows with no visitor identity, read back on the admin page's Analytics tab.
- `RESEND_API_KEY`, `MAIL_FROM` — optional. Transactional mail (email verification, password reset) goes out through the Resend HTTP API when the key is set, from `MAIL_FROM` (default `SpellControl <no-reply@spellcontrol.com>`; the sending domain must be verified in Resend). With the key unset the backend logs each message instead of sending it, so every recovery flow still works locally by reading the server log.
- `RETENTION_DISABLED` — optional. Set to `1` to switch off the daily retention sweep described under "Where data lives".
- `PORT` (default `3737`), `DB_PATH` (default `backend/data/scryfall-cache.db`).
- `OFFLINE_DATA_DIR` — optional. Directory where the persisted Scryfall oracle bulk (`offline-oracle.json.gz` + `offline-oracle.meta.json`) is written and read. Defaults to `dirname(DB_PATH)` so the bulk co-locates with the SQLite cache (a single `/data` mount survives container recreates). Set explicitly only for custom layouts.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_WEB_REDIRECT_URI`, `OAUTH_NATIVE_REDIRECT_URI` — optional. Enable "Continue with Google" SSO when all four are set; with any unset, the `/api/auth/google*` routes return 503 and the frontend hides the button. Create an OAuth 2.0 Client (Web application type) in the Google Cloud Console and register the redirect URIs you use. See `.env.example` for the values you'll want in dev vs prod.
- `ANDROID_APP_FINGERPRINTS` — optional. Comma-separated SHA-256 signing-cert fingerprints (debug + release; case- and colon-insensitive) for the Android APK. Enables `/.well-known/assetlinks.json`, which Android verifies so the App Link intent filter can intercept `https://spellcontrol.com/oauth/callback` URLs and hand the Google sign-in return to the installed app instead of leaving it stuck in the browser. With this unset the endpoint returns 404 and the native flow falls back to the legacy `spellcontrol://oauth/callback` custom scheme (works in Chrome only). Pull fingerprints with `keytool -list -v -keystore … -alias …` and set as a Fly secret.
- `APP_HTTPS_DEEPLINK_BASE` — optional. Origin used to build the native OAuth callback URL; defaults to `https://spellcontrol.com`. Override for a staging deployment that hosts its own `assetlinks.json` and a matching App Link intent filter.

## Architecture

The repo is a monorepo with five packages: `backend/`, `frontend/`, and three shared ones — `packages/game-core/`, `packages/binder-routing/`, and `packages/deck-metrics/`.

**Backend** — Node + Express 5 + TypeScript. Postgres (via Drizzle) stores user accounts and synced state. A SQLite cache (via better-sqlite3) holds Scryfall card data with a 7-day TTL. Format-specific parsers in `src/parsers/` handle import detection and normalization.

**Frontend** — React 19 + Vite + TypeScript + Zustand + react-router-dom 7. Collection and binder state lives in IndexedDB and localStorage, synced to the server on change. The `deck-builder/` subsystem handles EDHREC-powered deck generation with its own services, store, and types. Plain CSS with guild-themed custom properties for re-skinning.

**game-core** (`packages/game-core/`) — a zero-dependency, isomorphic package owning the multiplayer game-state reducer (`applyAction`, `createGameState`, loss/win logic, `GameState`/`GameAction` types). It is the single source of truth: the backend runs it for authoritative online sessions and the frontend runs it for local + optimistic play. Both consume it as a `file:` dependency (`@spellcontrol/game-core`) — `backend → game-core ← frontend`, with game-core a leaf. It builds a dual CJS (backend) + ESM (frontend bundle) output with shared types, has its own test suite (80% coverage gate), and there is no second copy to keep in lockstep.

**binder-routing** (`packages/binder-routing/`) — the second shared package, same shape (zero-dependency, isomorphic, dual CJS + ESM, its own 80%-gated test suite). It owns the binder routing engine: card-to-binder rule matching, filtering, sorting, and materialization. Consumed via `file:` dependency (`@spellcontrol/binder-routing`) by the frontend (live binder views) and the backend (shared-binder projections).

**deck-metrics** (`packages/deck-metrics/`) — the third shared package, same shape. It owns the Commander bracket estimator (hard floors, soft power score, signal breakdown) and its floor predicates, with tag membership injected via `TagLookup` so the package carries no tagger data or I/O. Consumed via `file:` dependency (`@spellcontrol/deck-metrics`) by the frontend (deck analysis, generation convergence) and the backend (the AI `check_bracket` tool).

Adding a shared package means registering it in every place that installs a consumer — both `ci.yml` jobs, the cron ingest workflows, the Android release build, and both stages of `backend/Dockerfile`. Miss one and the consumer's `npm ci` runs that package's dist-guarded `prepare` without its devDependencies, dying on `TS2688`; the places that aren't PR checks surface it weeks later on a cron or a deploy. `scripts/check-shared-package-registration.mjs` enforces this on every PR and prints the full list of what's missing — run it locally with `node scripts/check-shared-package-registration.mjs`.

### Online table: accepted ceilings

The online Commander table (`backend/src/routes/games.ts`, `frontend/src/store/play.ts`, `frontend/src/lib/playtest/projection.ts`) knowingly runs under the limits below. Each was a deliberate call, not an oversight: the row records why it is acceptable for a table of friends, how it fails (and what keeps that failure loud), and the upgrade that would lift it. A row leaves this ledger only when its upgrade ships; a limit that is not on it is a bug to fix, not a ceiling to accept.

| Ceiling                                                                                                                                                                                                                                                                           | Why it is accepted                                                                                                                                                                                                                                                                | How it fails, and what keeps it loud                                                                                                                                                                                                                                                                                                                | Upgrade path                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **One machine.** SSE/long-poll subscribers, published boards, consent requests and presence are all in-process maps.                                                                                                                                                              | The whole backend is single-machine by construction: the Scryfall SQLite cache lives on a per-machine Fly volume, so a second machine is never a casual scaling step.                                                                                                             | `fly scale count 2` would not error; each machine's clients would only see that machine's table (subscribers fall back to the 2.5s poll, requests and presence split-brain). `backend/src/fly-topology.ts` resolves `<app>.internal` at boot and every 5 minutes and logs an error above one address; `fly.toml` says why next to `[http_service]`. | Postgres `LISTEN/NOTIFY` fan-out plus tables for boards, requests and presence.                                 |
| **Boards are memory-only.** A seat's published `PublicBoard` is never persisted.                                                                                                                                                                                                  | `game_sessions.state` is version-CAS'd; storing boards there would bump the game version on every card drag and invalidate every client's `since`/`knownVersion` fast path.                                                                                                       | A backend restart or deploy drops every board until each seat's next change re-publishes it (150ms debounce); until then opponents see "no board shared yet" for that seat. Late joiners are unaffected: SSE sends a snapshot on connect and the first long-poll request carries `catchUp=1`.                                                       | Republish on reconnect (publishing is change-driven only today), or a boards table under the fan-out above.     |
| **Table signals are never stored.** Reactions, dice, chat and pointing have no map, snapshot or catch-up.                                                                                                                                                                         | By design: a missed emote or roll is a missed moment, not lost state, and stored chat would need retention, moderation and deletion.                                                                                                                                              | A signal broadcast while a long-poll is between requests is gone; every other frame kind (state, boards, requests) self-heals on the next poll because every `/poll` response carries full snapshots.                                                                                                                                               | None planned.                                                                                                   |
| **Hidden zones are client-authoritative.** Hand and library exist only on the owning device; the table receives a public projection (battlefield, graveyard, exile, command, hand and library counts).                                                                            | This is the trust model of a webcam game between friends. It is what makes the project tractable: no rules engine, no server-side deck state, no per-viewer state forks.                                                                                                          | A modified client can misreport hand or library counts or draw at will, and nothing server-side can tell. Only board size (64 KB) and battlefield `x`/`y` (0..1) are validated; the contents are opaque to the server, so clients render every opponent board defensively.                                                                          | Server-authoritative libraries (server-seeded shuffle, server-dealt draws) if play with strangers ever matters. |
| **Face-down redaction rests on opaque ids.** A face-down permanent still carries an instance id as its render key; the projection masks it with a per-page-load salted hash.                                                                                                      | Real instance ids (`cmd-<scryfall id>` for commanders) would leak identity; masking at the projection boundary fixes that without rekeying `commanderTax` and breaking saved sessions.                                                                                            | If any instance id ever becomes identity-derived without passing through the mask, redaction silently stops working. `projection.ts` documents the invariant and its tests cover it.                                                                                                                                                                | None needed while the invariant holds.                                                                          |
| **`PATCH /api/games/:code` is an existence oracle.** A live code you are not seated at answers 403 `Not a participant.`; an unknown code answers 404. Every read route deliberately answers a byte-identical stealth 404 for both.                                                | The 403 copy is what the client surfaces on a rejected action, and the route predates the stealth-404 ruling.                                                                                                                                                                     | One account can distinguish live 4-character codes from unused ones, but only at the write limiter's 300 requests per minute per IP against a ~1M code space (a full sweep takes days), and knowing a code still grants nothing: joining requires the session to be open and every other route stays stealth.                                       | Return the stealth 404 and teach the client's 403 branch to treat it as "game gone".                            |
| **Native is long-poll only.** `EventSource` exists in the Capacitor WebView but never connects: the backend has no CORS and the session cookie is `SameSite=Lax` (deliberate CSRF protection in `backend/src/auth.ts`), so credentialed CORS was rejected.                        | Long-poll rides the `fetch` path CapacitorHttp already patches. Each update costs one held request (25s hold, 250ms cycle floor), which is fine for a life pad and a low-frequency board.                                                                                         | A backgrounded WebView drops the held request without an error event; every return to visible forces a transport restart plus a catch-up refresh. A failed round-trip retries after 5s while the 2.5s poll carries the game.                                                                                                                        | A Capacitor-side SSE transport if long-poll latency ever shows up in play.                                      |
| **Presence is a 45s last-seen TTL, not a socket.** A seat counts as present if the server saw any traffic from it in the last 45s.                                                                                                                                                | A player's `connected` flag only flips on an explicit leave or join, so a locked phone would otherwise block every takeback forever. The TTL is deliberately not test-aware: a short test value made the suite flake under load.                                                  | A seat that dropped less than 45s ago is still a required approver, so a takeback can wait its full 60s and resolve as denied. A hold expires on its own after 90s.                                                                                                                                                                                 | Socket-level presence if the fan-out ever moves off the in-process registry.                                    |
| **Consent is coarse.** One decline denies immediately; unanimous approval passes; 60s expiry resolves as not approved; guest seats and absent seats are never required.                                                                                                           | It mirrors how a table of friends actually resolves a takeback, and the expiry is what keeps a hung request from wedging the table.                                                                                                                                               | A request raised while the only other player is between long-polls can expire unseen on their side (the 4s stale-approval banner and per-device expiry grace cover the visible cases).                                                                                                                                                              | None planned.                                                                                                   |
| **Eight SSE streams per user, then 429.** Counted across every code; long-poll subscribers do not count.                                                                                                                                                                          | A stream holds a socket, a heartbeat timer and a registry entry for as long as it is open, so an unbounded count is a cheap way to exhaust the machine from one account. Eight covers a few tabs on a couple of devices plus the zombies a network blip leaves for one heartbeat. | Over the cap the client drops to the 2.5s poll loop rather than evicting an older stream: `EventSource` reconnects on a server-side end, so eviction would ping-pong between tabs.                                                                                                                                                                  | Raise the constant if real use ever hits it.                                                                    |
| **Fixed rate and size budgets.** Reads (`GET /:code`, `/events`, `/poll`) share 200 per minute; writes 300; game creation 20; board publish 1200 per minute and 64 KB; signals 180; requests 30 and 4 KB; a `PATCH` batch is at most 50 actions and 32 KB, a note 500 characters. | Each budget is sized from the legitimate rate of the fastest real interaction (rapid life tapping, dragging a board) with headroom, and doubles as the sweep limiter on the code space.                                                                                           | A client that trips a limiter sees the transport fall back to the 2.5s poll until the window passes. The long-poll's 250ms cycle floor exists because a life-tap burst once hot-looped `/poll` into its own limiter.                                                                                                                                | Per-user rather than per-IP limiters if shared-IP tables (a game night on one Wi-Fi) ever trip them.            |
| **Stale sessions are swept at 24h.** The sweep deletes the row and broadcasts "game ended" to every subscriber.                                                                                                                                                                   | Sessions are cheap and a day-old table is abandoned; sweeping keeps the in-process maps bounded to live sessions.                                                                                                                                                                 | A client whose stream is orphaned but still open never receives the broadcast, so `tick` forces a real `GET /:code` at least every 30s even while the transport reports healthy; the 404 clears the game.                                                                                                                                           | None planned.                                                                                                   |

## API

All `/api/*` endpoints sit behind helmet and per-endpoint rate limiters.

The table below documents the collection-import, auth, and sync core. The rest of the surface is mounted per domain in `backend/src/server.ts` — one router each for `activity`, `admin`, `aggregates`, `ai`, `combos`, `discover`, `feedback`, `friends`, `game-nights`, `game-results`, `games`, `offline`, `pods`, `public`, `publications`, `reports`, `scanner`, `shares`, `tonight-trades`, `trades`, and `users` — with routes defined in the matching `backend/src/<domain>/` module.

| Method   | Path                         | Purpose                                                                                             |
| -------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET`    | `/health`                    | Liveness + cache stats                                                                              |
| `GET`    | `/api/sets`                  | Cached Scryfall set list (1h browser cache)                                                         |
| `POST`   | `/api/import`                | Multipart `file` or JSON `{ text }`. Returns enriched cards, format detection, unresolved names     |
| `POST`   | `/api/import-deck`           | Same shape as `/api/import` but parses commander / companion / sideboard sections                   |
| `GET`    | `/api/cards/:name/printings` | All printings of a card (for finish / treatment swaps)                                              |
| `POST`   | `/api/refresh-prices`        | Refresh prices for a list of cards without re-importing                                             |
| `POST`   | `/api/auth/register`         | Create a user. `{ username, password }` → session cookie. 5/hr per IP                               |
| `POST`   | `/api/auth/login`            | Sign in. `{ username, password }` → session cookie. 10 / 15 min per IP                              |
| `POST`   | `/api/auth/logout`           | Clears the session cookie                                                                           |
| `GET`    | `/api/auth/me`               | Returns the current user, or 401                                                                    |
| `POST`   | `/api/auth/forgot-password`  | `{ email }`. Always 200; a reset link is mailed only when a verified account uses that email. 5/hr  |
| `POST`   | `/api/auth/reset-password`   | `{ token, password }` from the mailed link → session cookie                                         |
| `POST`   | `/api/auth/me/password`      | `{ currentPassword?, newPassword }`. Current password required only when one is set (auth required) |
| `POST`   | `/api/auth/me/email`         | `{ email }`. Mails a verification link; the address is stored once `/api/auth/verify-email` is hit  |
| `DELETE` | `/api/auth/me`               | Permanently deletes the account and all synced data (auth required)                                 |
| `GET`    | `/api/sync?since=<cursor>`   | Paged delta pull — rows changed since the cursor rev, in rev order, with tombstones (auth required) |
| `POST`   | `/api/sync`                  | Delta push. `{ upserts, deletions }` per-row; server stamps the new `rev`. Last-write-wins per row  |

`EnrichedCard` combines import-row data (`copyId`, `name`, `setCode`, `collectorNumber`, `rarity`, `scryfallId`, `purchasePrice`, `finish`, `sourceCategory`, `sourceFormat`) with optional per-copy fields (`condition`, `language`, `altered`, `proxy`, `misprint`) and Scryfall enrichment (`cmc`, `typeLine`, `colorIdentity`, `colors`, `edhrecRank`, images, `finishes`, `layout`, `borderColor`, `legalities`, `oracleText`, `frameEffects`, `fullArt`, `manaCost`, `promoTypes`, `imageNormalBack` for DFCs).

## Tweakables

- Cache TTL — `TTL_MS` in [backend/src/cache.ts](backend/src/cache.ts)
- Scryfall batch size, batch concurrency, and inter-batch delay — top of [backend/src/scryfall.ts](backend/src/scryfall.ts) (`BATCH_SIZE`, `BATCH_CONCURRENCY`, `REQUEST_DELAY_MS`)
- Import chunk size and client upload concurrency — top of [frontend/src/lib/api.ts](frontend/src/lib/api.ts) (`IMPORT_CHUNK_SIZE`, `IMPORT_CHUNK_CONCURRENCY`)
- Scryfall bulk ingest flush size — `FLUSH_AT` in [backend/src/scryfall-bulk.ts](backend/src/scryfall-bulk.ts)
- Rate limits — `importLimiter` and `priceLimiter` in [backend/src/server.ts](backend/src/server.ts)
- AI "Budget picks" per-card ceiling (same number in USD or EUR, checked in the player's display currency) — `BUDGET_CEILING` in [backend/src/ai/deck-review.ts](backend/src/ai/deck-review.ts) (mirrored for the label as `AI_BUDGET_CEILING` in [frontend/src/lib/ai-scope.ts](frontend/src/lib/ai-scope.ts))
- AI model list price used by the admin panel's spend estimate (USD per million tokens: input, output, cache write, cache read) — `AI_USD_PER_MTOK` next to `AI_MODEL` in [backend/src/ai/client.ts](backend/src/ai/client.ts); change the two together
- Default sorts for new binders — `NEW_BINDER_DEFAULT_SORTS` in [frontend/src/lib/sorting.ts](frontend/src/lib/sorting.ts)
- Sticky price margin (reviewed cards don't leave a binder for a within-margin price wobble) — `PRICE_STICKINESS_MARGIN` in [packages/binder-routing/src/rules.ts](packages/binder-routing/src/rules.ts)
- Default EDHREC top-N — `DEFAULT_EDHREC_TOP_N` in [frontend/src/components/BinderEditor.tsx](frontend/src/components/BinderEditor.tsx)
- Commander-aggregate rollup thresholds (min sample sizes, budget bucket boundaries, top-card cap) — top of [backend/src/aggregates/rollup.ts](backend/src/aggregates/rollup.ts)
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
npm run build             # production build for both (frontend postbuild writes a .br + .gz beside every text asset; the backend serves those)
npm run build:budget --prefix frontend   # boot payload budget: gzipped module-preloaded JS + render-blocking CSS vs frontend/scripts/check-boot-budget.mjs ceilings (CI runs it after the build)
npm run lint              # eslint + stylelint
npm run lint:fix
npm run format            # prettier --write
npm run format:check
npm run journey -- --base http://localhost:3737 --browser chrome   # real-browser journey (see below)
```

### Nightly journey

`.github/workflows/nightly-journey.yml` runs `scripts/journey.mjs` every night against a production build served by the backend, in a real Chrome (phone + desktop viewports) and a real Firefox (desktop): sign-up → sample collection → deck creation through the UI → every route the router owns. Any uncaught error, console error, horizontal overflow, empty body, or missing title fails the run; screenshots and `report.json` are uploaded either way. Run it locally against any base URL with the command above (`JOURNEY_CHROME` / `JOURNEY_FIREFOX` point at a browser binary when the default paths don't fit).

Per workspace, both `frontend` and `backend` also expose `test:watch` and `test:coverage`. CI enforces an 80% coverage floor on `lib/` and parser modules. The three shared packages (`game-core`, `binder-routing`, `deck-metrics`) are each built and tested independently (their own `npm test` / `test:coverage`, run as dedicated CI jobs and built before the consumer jobs); the root `npm test` covers `frontend` + `backend` only.

`husky` + `lint-staged` run prettier on staged files before commit.

## Tests & CI

To add a test, drop a `*.test.ts` (or `*.test.tsx`) file next to the module — Vitest picks it up automatically. CI runs lint, typecheck, tests, and coverage on every push and pull request via GitHub Actions, and Dependabot keeps deps current. Frontend coverage is gated per directory (`frontend/vitest.config.ts` lists the six scopes and their floors); the floors only ever ratchet upward. Every `/api` response carries an `X-Request-Id` header (Fly's own request id when present), and a 500 body includes the same `requestId`, so a problem report can be matched to the server log line that carries it.

## License

Proprietary — all rights reserved. See [LICENSE](./LICENSE). No permission is granted to copy, modify, redistribute, or resell this software.

## Legal & attribution

SpellControl is unofficial Fan Content permitted under the [Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.

Card data and images are provided by [Scryfall](https://scryfall.com). SpellControl is not affiliated with Scryfall, ManaBox, Moxfield, Archidekt, Deckbox, TCGplayer, or Cardsphere.

The privacy policy and terms of service ship as static pages at `/privacy.html` and `/terms.html` (`frontend/public/`), linked from the welcome page, the footer, the sign-up form and Settings.
