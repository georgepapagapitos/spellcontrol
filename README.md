# MTG Binder Planner

Take a collection export from any popular Magic: The Gathering tool, define your physical binders with custom rules, and see exactly which cards go where. Watch your bulk pile shrink as you whittle down the unbinned bucket.

## How it works

1. **Import your cards** — upload a CSV from ManaBox / Archidekt / Moxfield / Deckbox / TCGplayer / etc., or paste a list of card names. Format is auto-detected.
2. **Create binders** — each binder is a set of filter rules (rarity, price, color, type, EDHREC popularity, etc.) plus a sort spec and pocket size.
3. **Cards flow into binders by priority** — each card joins the first binder whose rules match. Anything that doesn't match any binder falls into the **Bulk (unbinned)** bucket.
4. **Reorder binders** with up/down arrows on the active tab — higher position = first dibs.
5. **Stats bar** shows how many cards are in binders vs still in bulk, so you can watch your progress.

## Supported import formats

The importer auto-detects which format you have:

| Format | How to recognize | What we use |
|---|---|---|
| **ManaBox CSV/TSV** | Tab-delimited, has `Scryfall ID` and `Binder Name` columns | Direct Scryfall ID lookup |
| **Moxfield CSV** | Has `Count`, `Tradelist Count`, `Edition` columns | Name + set + collector |
| **Archidekt CSV** | Has `Name`, `Edition`, `Quantity` columns | Name + set + collector |
| **Generic CSV** | Any CSV with at least a `Name` or `Card Name` column | Whatever fields are present |
| **MTGA format** | Lines like `1 Sol Ring (CMR) 472` | Name + set + collector |
| **Plain text** | One card name per line, optional `1x ` prefix | Name only (Scryfall picks a printing) |

Quantities supported across all formats. Split cards (`Fire // Ice`), DFCs (`Valki, God of Lies // Tibalt, Cosmic Impostor`), and adventure cards (`Bonecrusher Giant // Stomp`) all parse correctly. Foil notation (`*F*`, `[FOIL]`) is recognized but treated as a name suffix to strip.

## Where data lives

- **Your binders** — stored in `localStorage` in your browser. Persists indefinitely. Does NOT sync across devices.
- **Your card collection** — stored in `IndexedDB` in your browser. Persists across page refreshes; replaced or merged when you import again. Use "Clear cached collection" to wipe it.
- **Scryfall card data** — cached server-side in SQLite for 7 days. Shared across all users.

## Architecture

```
mtg-binder-planner/
├── backend/                     Node + Express + TypeScript + SQLite
│   └── src/
│       ├── server.ts            /api/import (file or text), /health
│       ├── parsers/
│       │   ├── index.ts         Format detection & dispatch
│       │   ├── manabox.ts       ManaBox TSV (handles tab-shifted columns)
│       │   ├── csv.ts           Archidekt / Moxfield / Deckbox / generic CSV
│       │   ├── text.ts          MTGA format + plain card lists
│       │   └── types.ts         Normalized ImportRow type
│       ├── scryfall.ts          Resolves cards by ID, name+set+collector, or name
│       ├── cache.ts             SQLite cache for Scryfall data
│       └── types.ts             Shared types
└── frontend/                    React + Vite + TypeScript + Zustand
    └── src/
        ├── App.tsx              Materializes binders from cards + rules
        ├── components/
        │   ├── UploadPanel.tsx       File picker + paste textarea + replace/merge toggle
        │   ├── ConfigPanel.tsx       Default pocket size, search
        │   ├── StatsBar.tsx          In binders / still in bulk / value
        │   ├── BinderTabs.tsx        Tabs with reorder/edit/delete
        │   ├── BinderEditor.tsx      Modal with OR-grouped rules
        │   ├── BinderView.tsx        Renders the active binder
        │   ├── PageGrid.tsx          Single physical page (4/9/18-pocket)
        │   ├── CardSlot.tsx          One card slot with hover tooltip
        │   ├── Legend.tsx
        │   └── Footer.tsx            Scryfall + ManaBox attribution
        ├── lib/
        │   ├── rules.ts              Rule-matching engine (OR groups)
        │   ├── materialize.ts        Routes cards into binders + unbinned
        │   ├── sorting.ts            Multi-level sort
        │   ├── colors.ts             Scryfall color-identity grouping
        │   ├── card-types.ts         Type-line parsing
        │   ├── pdf-export.ts         PDF generator
        │   ├── local-cards.ts        IndexedDB persistence
        │   └── api.ts                Backend client
        ├── store/collection.ts       Zustand store
        ├── styles/global.css
        └── types/index.ts
```

## Setup

### Prerequisites

- **Node.js 18 or newer**
- A C++ build toolchain (for `better-sqlite3`):
  - macOS: `xcode-select --install`
  - Linux: `sudo apt install build-essential python3`
  - Windows: install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload

### Backend

```bash
cd backend
npm install
npm run dev   # listens on :3737
```

### Frontend

```bash
cd frontend
npm install
npm run dev   # listens on :5173, proxies /api → :3737
```

Open http://localhost:5173.

## Rule semantics

Each binder has one or more **match groups**. A card joins the binder if it matches **any** group (OR). Within a single group, every set field must match (AND). Empty/unset fields impose no constraint.

This lets you express things like *"common/uncommon EDH staples OR any C/U worth $1+"* in one binder by using two groups.

Rule fields per group:

- **Rarity** — multi-select.
- **Color identity** — based on Scryfall's color identity. `M` = any multicolor.
- **Type** — substring match against Scryfall's type line. ANY of the selected types matches.
- **Price range** — min / max in dollars.
- **CMC range** — min / max mana value.
- **Name contains** — case-insensitive substring.
- **Set codes** — comma-separated set code list, exact match.
- **Foil** — any / foil only / non-foil only.
- **Source category contains** — substring on the original category label from your import (ManaBox binder name, Moxfield tag, etc).
- **EDHREC popularity** — "Top N most popular EDH cards" using `edhrec_rank` from Scryfall.

## API

- `POST /api/import` — accepts either multipart with `file` field, or JSON `{ text: string }`. Returns enriched cards + format detection + unresolved names.
- `GET  /health` — health check + Scryfall cache stats.

## Tweakables

- Cache TTL: `TTL_MS` in `backend/src/cache.ts`
- Scryfall batch size / rate limit: top of `backend/src/scryfall.ts`
- Default sorts for new binders: `NEW_BINDER_DEFAULT_SORTS` in `frontend/src/lib/sorting.ts`
- Default EDHREC top-N: `DEFAULT_EDHREC_TOP_N` in `frontend/src/components/BinderEditor.tsx`
- Default port: `PORT` env var (e.g. `PORT=3000 npm run dev`)

## Contributing

Issues and pull requests welcome. Especially helpful:

- Sample CSV exports from collection tools we don't yet handle well (open an issue with a small redacted sample attached).
- Bug reports for cards that fail to resolve via Scryfall — include the card name, set, collector number, and the format you imported from.
- New rule fields or sort options.

For local development, both `backend` and `frontend` run with `npm run dev` and have TypeScript strict mode + `noUnusedLocals` enabled, so the typechecker will catch most issues. There are inline tests in a few key modules (parser dispatch, rules engine, Scryfall resolution) — to add a test, drop a `*.test.ts` file next to the module and run it with `npx tsx path/to/file.test.ts`.

## License

MIT. See [LICENSE](./LICENSE).

This tool is unofficial and not affiliated with Wizards of the Coast, Scryfall, or ManaBox. Magic: The Gathering and all related assets are property of Wizards of the Coast LLC.
