# Sub-Collections — Design

Date: 2026-05-18
Status: Approved (pending spec review)
Branch: `feat/sub-collections`

## Problem

The app has a single flat collection. The only grouping mechanism is binders,
which are **rule/filter-based and overlapping** (a card can be in many binders,
no card is ever "allocated"). Users want to split their physical collection into
named storage locations — e.g. "Bulk", "Rares+Mythics", "Trade box" — where a
card lives in **exactly one** place, assigned manually, with no rule editor.

This is conceptually distinct from binders: it models _where a card physically
is_, not _which filtered views it appears in_.

## Goals

- Every collection card belongs to exactly one **sub-collection** (a partition).
- Lightweight: manual assignment, no rule/filter editor.
- **Orthogonal** to binders and deck-building: binders still filter across ALL
  cards; deck-building still sees everything. Sub-collection is an optional
  view filter, never hides cards from binders/decks.
- A built-in synthetic **"Main"** bucket is the default for every existing and
  unassigned card — nothing changes visually until the user moves cards.
- Assignments **survive a `replace` re-import** (the common ManaBox re-export
  flow), reusing the existing durability mechanism.
- Zero backend / DB schema changes.

## Non-Goals (YAGNI)

- No rule-driven sub-collections (that is what binders are for).
- No multiple top-level collections / `userData.collections[]` schema split.
- No per-physical-copy exact durability across re-import (not achievable — see
  Durability caveat).
- No nested sub-collections.
- No backend validation of the new fields (consistent with existing posture;
  the collection blob is already an unvalidated JSONB catch-all).

## Data Model

New type (frontend `types/index.ts`, mirrored in backend `types.ts` only if a
backend type references it — it does not need to, the blob is opaque server-side):

```ts
interface SubCollectionDef {
  id: string; // uuid
  name: string; // user label, trimmed + length-clamped client-side
  color?: string; // optional hex for UI badging (mirrors BinderDef.color)
  order: number; // display order
}
```

Storage: `subCollections: SubCollectionDef[]` added to **`StoredCollection`**
(`frontend/src/lib/local-cards.ts`), alongside `cards` / `importHistory`. It
therefore:

- persists in IndexedDB through the existing `saveCollection`/`loadCollection`,
- syncs through the existing `collection` blob on `PUT/GET /api/sync` under the
  same `version` optimistic-concurrency token,
- needs **no backend or Drizzle schema change** (verified:
  `backend/src/routes/sync.ts` does no shape validation — "any object shape").

`EnrichedCard` gains two optional fields:

```ts
subCollectionId?: string;   // which SubCollectionDef.id this copy lives in
subCollectionKey?: string;  // durable shadow = printingFinishKey(card)
```

Semantics:

- `subCollectionId === undefined` ⇒ the card is in the synthetic **"Main"**
  bucket. "Main" is **not** a stored `SubCollectionDef`; it cannot be renamed,
  recolored, reordered, or deleted. No bulk data migration — existing cards
  simply read as Main.
- Deleting a `SubCollectionDef` clears `subCollectionId` (and
  `subCollectionKey`) on its cards ⇒ they fall back to Main. No orphans.

## Durability (re-import survival)

Chosen approach: **reuse the existing binder/deck durability mechanism.**

- Durable key = `printingFinishKey(card)` (`scryfallId:finish`), defined at
  `frontend/src/lib/collection-mutations.ts:8`.
- Binders already survive re-import via `reconcileBinderRefs()`
  (`frontend/src/lib/binder-refs.ts:121`), re-run after every collection
  mutation that changes copyIds (including `importCards` in
  `frontend/src/store/collection.ts`).
- When the user assigns a card to a sub-collection, set **both**
  `subCollectionId` and `subCollectionKey = printingFinishKey(card)`.
- During the post-import remap pass (same place binder refs reconcile), build a
  `Map<printingFinishKey, subCollectionId>` from the _previous_ cards' shadow
  pairs, then for each new card with no `subCollectionId`, restore it if its key
  is present in that map. New cards (no prior key) stay Main.

This makes a `replace` re-import keep "Bulk = Bulk" instead of dumping
everything back to Main.

### Durability caveat (documented, accepted)

Granularity is **printing + finish**, not per-physical-copy — identical to
binders and deck allocations today. If a user owns 3 identical Sol Rings split
1-Bulk / 2-Main and re-imports, the split is restored _by count_ but not by a
specific physical row (copy UUIDs are freshly minted by the import pipeline, so
exact per-copy identity does not exist to preserve). This is consistent with
existing app behavior and is explicitly accepted, not a defect to fix here.

## Security

- No new endpoint or trust boundary; user-owned data in the user's own synced
  blob.
- `subCollections[].name` and `subCollectionId` are client-trusted strings. The
  backend already does no validation of the collection blob (pre-existing). No
  injection surface (values never reach SQL or unescaped HTML).
- Mitigations baked into the design: client-side trim + length clamp on names;
  any `subCollectionId` not resolvable to a `SubCollectionDef` is treated as
  Main (defensive default, also covers stale ids after a delete races a sync).

## UI Surface

- **CollectionPage / CollectionFiltersDialog**: a sub-collection filter
  selector + per-bucket counts, slotted next to the existing binder filter /
  hero stats. Filtering is a _view_ concern only.
- **CardListTable** (net-new UI): add a checkbox column + a bulk action toolbar
  with "Move to sub-collection…", reusing the `AddToBinderSheet` modal pattern
  (`frontend/src/components/CardRowMenu.tsx`). There is no existing bulk-select
  infrastructure — this is the only substantial new UI.
- **CardRowMenu**: add a "Move to sub-collection…" per-row item.
- **CardEditDialog**: a single-card sub-collection dropdown, following the
  existing per-card field pattern (e.g. finish selector).
- **ImportModeDialog** (`frontend/src/components/UploadPanel.tsx`): add an
  "Add to: [sub-collection ▾] / + New" selector. Extend the store import call
  `importCards(result, fileName, mode, options)` so `options` carries
  `subCollectionId`; new cards from that import are stamped with it (and their
  shadow key).

`sourceCategory` is unaffected — it is immutable, display-only, explicitly
non-filterable, and does not collide with this user-mutable layer.

## Store Mutators (`frontend/src/store/collection.ts`)

New actions (this file is outside the 80% coverage gate but still gets tests):

- `createSubCollection(name, color?) → id`
- `renameSubCollection(id, name)` / `recolorSubCollection(id, color)` /
  `reorderSubCollections(ids[])`
- `deleteSubCollection(id)` — clears id/key on member cards (→ Main)
- `moveCardsToSubCollection(copyIds[], subCollectionId | null)` — sets/clears
  `subCollectionId` and `subCollectionKey`; `null` = move to Main
- `importCards(...)` extended to stamp imported cards with the chosen
  `subCollectionId` and to run sub-collection key restoration in the existing
  post-import remap pass

All mutators set the sync dirty flag through the existing path.

## Testing

New `frontend/src/lib/sub-collections.test.ts` (inside the coverage gate;
follows the established `// @vitest-environment happy-dom` +
`import 'fake-indexeddb/auto'` + mocked `authApi` pattern from
`sync.test.ts` / `local-cards.test.ts`):

1. **IndexedDB round-trip**: `subCollections` survives
   `saveCollection`/`loadCollection`.
2. **Sync push**: a local sub-collection mutation pushes `subCollections`
   inside the `collection` blob and sets the dirty flag.
3. **Sync pull**: a server snapshot's `collection.subCollections` overwrites
   local; respects the existing mutation-during-fetch / hydrate-failed
   invariants (no destructive push from an unhydrated cache).
4. **Durability**: assign → simulate `replace` re-import (fresh copyIds) →
   assignments restored by printing+finish key; brand-new cards stay Main;
   count-granularity behavior asserted explicitly.
5. **Binder orthogonality**: a card with a `subCollectionId` still routes into
   binders purely by filter (binder membership unchanged by sub-collection),
   via `materializeBinders`.
6. **Delete fallback**: deleting a `SubCollectionDef` moves its cards to Main.

Store-mutator tests (create/rename/delete/move/import-stamp) live alongside
existing `frontend/src/store/collection-*.test.ts` files.

## Out of Scope / Future

- Rule-assisted assignment ("suggest moving all commons to Bulk").
- Per-sub-collection import history.
- Drag-and-drop between sub-collections in the table.
