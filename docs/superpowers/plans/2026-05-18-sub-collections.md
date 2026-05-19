# Sub-Collections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight, manually-assigned partition ("sub-collection" — e.g. Bulk, Rares+Mythics) to each collection card, orthogonal to binders and decks, that survives a `replace` re-import.

**Architecture:** A `subCollections: SubCollectionDef[]` list rides inside the existing `StoredCollection` blob (syncs through the existing payload, no backend/schema change). Each `EnrichedCard` gains `subCollectionId?` plus a durable `subCollectionKey?` shadow (= `printingFinishKey`). Re-import survival reuses the exact pattern binders use: a pure restore pass keyed on printing+finish. Pure logic lives in a new `src/lib/sub-collections.ts` (inside the 80% coverage gate); store mutators and UI consume it. The synthetic "Main" bucket is `subCollectionId === undefined` — never stored, never migrated.

**Tech Stack:** React 18, Zustand, TypeScript, Vitest (happy-dom + fake-indexeddb), IndexedDB via `idb`.

**Spec:** `docs/superpowers/specs/2026-05-18-sub-collections-design.md`

---

## File Structure

| File                                                   | Responsibility                                                                        | Action     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- | ---------- |
| `frontend/src/types/index.ts`                          | `SubCollectionDef` type; `EnrichedCard.subCollectionId/Key`                           | Modify     |
| `frontend/src/lib/local-cards.ts`                      | `StoredCollection.subCollections`                                                     | Modify     |
| `frontend/src/lib/sub-collections.ts`                  | Pure logic: clamp, assign, restore, resolve                                           | **Create** |
| `frontend/src/lib/sub-collections.test.ts`             | Tests for the pure logic                                                              | **Create** |
| `frontend/src/store/collection.ts`                     | `subCollections` state + CRUD/move mutators; thread persistence; extend `importCards` | Modify     |
| `frontend/src/store/collection-subcollections.test.ts` | Store mutator + import-stamp + restore tests                                          | **Create** |
| `frontend/src/lib/sync.ts`                             | Push/pull `subCollections` through the blob                                           | Modify     |
| `frontend/src/lib/sync.test.ts`                        | Sync round-trip + invariants for `subCollections`                                     | Modify     |
| `frontend/src/lib/materialize.test.ts`                 | Binder-orthogonality regression test                                                  | Modify     |
| `frontend/src/components/UploadPanel.tsx`              | Import-target selector → import options                                               | Modify     |
| `frontend/src/components/CardEditDialog.tsx`           | Single-card sub-collection dropdown                                                   | Modify     |
| `frontend/src/components/CardListTable.tsx`            | Bulk-select column + "Move to…" toolbar                                               | Modify     |
| `frontend/src/components/CardRowMenu.tsx`              | Per-row "Move to sub-collection…" item                                                | Modify     |
| `frontend/src/pages/CollectionPage.tsx`                | Sub-collection view filter + per-bucket counts                                        | Modify     |

UI tasks (7–10) are validated by the user manually (typecheck + lint only; **do not** run preview/screenshot tools — per project preference). Logic tasks (2–6) are TDD.

---

## Task 1: Types

**Files:**

- Modify: `frontend/src/types/index.ts` (EnrichedCard ~lines 1–84; add new interface near it)
- Modify: `frontend/src/lib/local-cards.ts:39-51` (StoredCollection)

- [ ] **Step 1: Add `SubCollectionDef` and the two card fields**

In `frontend/src/types/index.ts`, immediately **after** the closing `}` of the `EnrichedCard` interface, add:

```ts
/**
 * A user-defined physical storage location (e.g. "Bulk", "Rares+Mythics").
 * A partition: every card is in exactly one. The synthetic "Main" bucket is
 * NOT represented here — it is `EnrichedCard.subCollectionId === undefined`.
 */
export interface SubCollectionDef {
  id: string;
  /** User label. Trimmed + length-clamped client-side (see clampSubCollectionName). */
  name: string;
  /** Optional hex for UI badging (mirrors BinderDef.color). */
  color?: string;
  /** Display order, ascending. */
  order: number;
}
```

Inside the `EnrichedCard` interface, **before** the final `promoTypes?: string[];` field, add:

```ts
  /**
   * Which SubCollectionDef.id this physical copy lives in. Undefined ⇒ the
   * synthetic built-in "Main" bucket (never stored as a SubCollectionDef).
   */
  subCollectionId?: string;
  /**
   * Durable natural-key shadow of subCollectionId (= printingFinishKey).
   * copyIds are regenerated on every import; this key is what lets the
   * assignment survive a re-import, exactly like BinderDef.pinnedKeys.
   */
  subCollectionKey?: string;
```

- [ ] **Step 2: Add `subCollections` to `StoredCollection`**

In `frontend/src/lib/local-cards.ts`, the current interface (lines 39–51) is:

```ts
export interface StoredCollection {
  fileName: string;
  cards: EnrichedCard[];
  scryfallHits: number;
  scryfallMisses: number;
  uploadedAt: number;
  /**
   * History of imports that contributed to the current collection. After a
   * `replace` import this contains a single entry; after merges, one entry per
   * import in chronological order.
   */
  importHistory?: ImportHistoryEntry[];
}
```

Add a field after `importHistory?`:

```ts
  /**
   * User-defined sub-collection (physical-location) definitions. Optional so
   * collections saved before this existed load fine (treated as `[]`).
   */
  subCollections?: SubCollectionDef[];
```

Ensure `SubCollectionDef` is imported at the top of `local-cards.ts` from `../types` (add to the existing type import from `../types`).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --prefix frontend`
Expected: PASS (purely additive optional fields).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/lib/local-cards.ts
git commit -m "feat(subcollections): add SubCollectionDef type and card/storage fields"
```

---

## Task 2: Pure sub-collection logic module (TDD)

This file lives in `src/lib/**` → **inside the 80% coverage gate**. Tests are mandatory.

**Files:**

- Create: `frontend/src/lib/sub-collections.ts`
- Create: `frontend/src/lib/sub-collections.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/sub-collections.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { EnrichedCard, SubCollectionDef } from '../types';
import {
  MAX_SUBCOLLECTION_NAME,
  clampSubCollectionName,
  assignSubCollection,
  buildSubCollectionKeyMap,
  restoreSubCollectionAssignments,
  resolveSubCollectionId,
} from './sub-collections';

function card(
  copyId: string,
  scryfallId: string,
  finish: 'nonfoil' | 'foil' = 'nonfoil'
): EnrichedCard {
  return { copyId, scryfallId, finish, name: scryfallId, foil: finish === 'foil' } as EnrichedCard;
}

describe('clampSubCollectionName', () => {
  it('trims whitespace', () => {
    expect(clampSubCollectionName('  Bulk  ')).toBe('Bulk');
  });
  it('clamps to the max length', () => {
    const long = 'x'.repeat(MAX_SUBCOLLECTION_NAME + 10);
    expect(clampSubCollectionName(long)).toHaveLength(MAX_SUBCOLLECTION_NAME);
  });
});

describe('assignSubCollection', () => {
  it('sets id and the durable key when assigning', () => {
    const out = assignSubCollection(card('c1', 'sf1', 'foil'), 'sc1');
    expect(out.subCollectionId).toBe('sc1');
    expect(out.subCollectionKey).toBe('sf1:foil');
  });
  it('clears both fields when assigning null (move to Main)', () => {
    const assigned = assignSubCollection(card('c1', 'sf1'), 'sc1');
    const cleared = assignSubCollection(assigned, null);
    expect(cleared.subCollectionId).toBeUndefined();
    expect(cleared.subCollectionKey).toBeUndefined();
  });
  it('does not mutate the input', () => {
    const input = card('c1', 'sf1');
    assignSubCollection(input, 'sc1');
    expect(input.subCollectionId).toBeUndefined();
  });
});

describe('restoreSubCollectionAssignments', () => {
  it('restores assignment onto a fresh copy with the same printing+finish', () => {
    const prev = [assignSubCollection(card('old', 'sf1', 'foil'), 'sc1')];
    const next = [card('new', 'sf1', 'foil')];
    const restored = restoreSubCollectionAssignments(next, prev);
    expect(restored[0].subCollectionId).toBe('sc1');
    expect(restored[0].subCollectionKey).toBe('sf1:foil');
  });
  it('leaves brand-new cards (no prior key) in Main', () => {
    const prev = [assignSubCollection(card('old', 'sf1'), 'sc1')];
    const next = [card('new2', 'sfDIFFERENT')];
    const restored = restoreSubCollectionAssignments(next, prev);
    expect(restored[0].subCollectionId).toBeUndefined();
  });
  it('restores by count when multiple copies share a key (best-effort)', () => {
    const prev = [assignSubCollection(card('o1', 'sf1'), 'sc1'), card('o2', 'sf1')];
    const next = [card('n1', 'sf1'), card('n2', 'sf1')];
    const restored = restoreSubCollectionAssignments(next, prev);
    const assigned = restored.filter((c) => c.subCollectionId === 'sc1');
    expect(assigned).toHaveLength(1);
  });
  it('does not overwrite an explicit assignment already on the new card', () => {
    const prev = [assignSubCollection(card('o1', 'sf1'), 'sc1')];
    const next = [assignSubCollection(card('n1', 'sf1'), 'sc2')];
    const restored = restoreSubCollectionAssignments(next, prev);
    expect(restored[0].subCollectionId).toBe('sc2');
  });
});

describe('resolveSubCollectionId', () => {
  const defs: SubCollectionDef[] = [{ id: 'sc1', name: 'Bulk', order: 0 }];
  it('returns the id when it resolves to a def', () => {
    expect(resolveSubCollectionId('sc1', defs)).toBe('sc1');
  });
  it('returns undefined (Main) for an unknown id', () => {
    expect(resolveSubCollectionId('ghost', defs)).toBeUndefined();
  });
  it('returns undefined for undefined input', () => {
    expect(resolveSubCollectionId(undefined, defs)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --prefix frontend -- src/lib/sub-collections.test.ts`
Expected: FAIL — `Cannot find module './sub-collections'`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/sub-collections.ts`:

```ts
import type { EnrichedCard, SubCollectionDef } from '../types';
import { printingFinishKey } from './collection-mutations';

/** Matches the binder-name input cap in the UI. */
export const MAX_SUBCOLLECTION_NAME = 60;

export function clampSubCollectionName(name: string): string {
  return name.trim().slice(0, MAX_SUBCOLLECTION_NAME);
}

/**
 * Returns a new card assigned to `subCollectionId` (and stamps the durable
 * key shadow), or moved back to Main when `subCollectionId` is null.
 * Pure — never mutates the input.
 */
export function assignSubCollection(
  card: EnrichedCard,
  subCollectionId: string | null
): EnrichedCard {
  if (subCollectionId == null) {
    const { subCollectionId: _drop, subCollectionKey: _dropKey, ...rest } = card;
    return rest;
  }
  return { ...card, subCollectionId, subCollectionKey: printingFinishKey(card) };
}

/**
 * Builds a printingFinishKey → subCollectionId map from previously-assigned
 * cards, preserving multiplicity: if N prior copies of a key were assigned to
 * sc1, the map records N occurrences (as a count per key→id).
 */
export function buildSubCollectionKeyMap(
  prevCards: EnrichedCard[]
): Map<string, { id: string; count: number }> {
  const map = new Map<string, { id: string; count: number }>();
  for (const c of prevCards) {
    if (!c.subCollectionId) continue;
    const key = c.subCollectionKey ?? printingFinishKey(c);
    const entry = map.get(key);
    if (entry && entry.id === c.subCollectionId) entry.count += 1;
    else if (!entry) map.set(key, { id: c.subCollectionId, count: 1 });
  }
  return map;
}

/**
 * Re-applies sub-collection assignments onto a freshly-imported card array
 * (which has new copyIds) by matching on printingFinishKey, best-effort by
 * count. Cards that already carry an explicit subCollectionId are left as-is.
 * Pure — returns a new array; reuses element refs when unchanged.
 */
export function restoreSubCollectionAssignments(
  newCards: EnrichedCard[],
  prevCards: EnrichedCard[]
): EnrichedCard[] {
  const keyMap = buildSubCollectionKeyMap(prevCards);
  if (keyMap.size === 0) return newCards;
  const remaining = new Map([...keyMap].map(([k, v]) => [k, { id: v.id, count: v.count }]));
  return newCards.map((c) => {
    if (c.subCollectionId) return c;
    const key = printingFinishKey(c);
    const slot = remaining.get(key);
    if (!slot || slot.count <= 0) return c;
    slot.count -= 1;
    return { ...c, subCollectionId: slot.id, subCollectionKey: key };
  });
}

/**
 * Returns the id only if it resolves to a real def; otherwise undefined
 * (the defensive "treat unknown as Main" rule, also covers a delete racing
 * a sync). Undefined input → undefined.
 */
export function resolveSubCollectionId(
  id: string | undefined,
  defs: SubCollectionDef[]
): string | undefined {
  if (!id) return undefined;
  return defs.some((d) => d.id === id) ? id : undefined;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --prefix frontend -- src/lib/sub-collections.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck --prefix frontend && npm run lint --prefix frontend`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/sub-collections.ts frontend/src/lib/sub-collections.test.ts
git commit -m "feat(subcollections): pure assign/restore/resolve logic"
```

---

## Task 3: Store state + CRUD/move mutators

**Files:**

- Modify: `frontend/src/store/collection.ts` (CollectionState interface ~36–149; store body)
- Create: `frontend/src/store/collection-subcollections.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/store/collection-subcollections.test.ts`:

```ts
// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { useCollectionStore } from './collection';
import { useDecksStore } from './decks';
import { clearCollection, loadCollection } from '../lib/local-cards';
import type { EnrichedCard } from '../types';

function enriched(copyId: string, scryfallId: string): EnrichedCard {
  return {
    copyId,
    name: 'Sol Ring',
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'uncommon',
    scryfallId,
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
  };
}

beforeEach(async () => {
  await clearCollection();
  useDecksStore.setState({ decks: [], hydrated: true });
  useCollectionStore.setState({
    cards: [],
    binders: [],
    subCollections: [],
    fileName: '',
    importHistory: [],
    uploadedAt: null,
    hydrating: false,
  });
});

describe('sub-collection CRUD', () => {
  it('creates a sub-collection with a clamped, trimmed name and returns its id', () => {
    const id = useCollectionStore.getState().createSubCollection('  Bulk  ');
    const defs = useCollectionStore.getState().subCollections;
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({ id, name: 'Bulk', order: 0 });
  });

  it('renames and recolors', () => {
    const id = useCollectionStore.getState().createSubCollection('Bulk');
    useCollectionStore.getState().renameSubCollection(id, 'Trade');
    useCollectionStore.getState().recolorSubCollection(id, '#ff0000');
    const def = useCollectionStore.getState().subCollections[0];
    expect(def).toMatchObject({ name: 'Trade', color: '#ff0000' });
  });

  it('moves cards into a sub-collection and stamps the durable key', async () => {
    useCollectionStore.setState({ cards: [enriched('c1', 'sf1')] });
    const id = useCollectionStore.getState().createSubCollection('Bulk');
    await useCollectionStore.getState().moveCardsToSubCollection(['c1'], id);
    const c = useCollectionStore.getState().cards[0];
    expect(c.subCollectionId).toBe(id);
    expect(c.subCollectionKey).toBe('sf1:nonfoil');
    const stored = await loadCollection();
    expect(stored?.subCollections?.[0].id).toBe(id);
    expect(stored?.cards[0].subCollectionId).toBe(id);
  });

  it('deleting a sub-collection sends its cards back to Main', async () => {
    useCollectionStore.setState({ cards: [enriched('c1', 'sf1')] });
    const id = useCollectionStore.getState().createSubCollection('Bulk');
    await useCollectionStore.getState().moveCardsToSubCollection(['c1'], id);
    await useCollectionStore.getState().deleteSubCollection(id);
    expect(useCollectionStore.getState().subCollections).toHaveLength(0);
    const c = useCollectionStore.getState().cards[0];
    expect(c.subCollectionId).toBeUndefined();
    expect(c.subCollectionKey).toBeUndefined();
  });

  it('reorders sub-collections by id list', () => {
    const a = useCollectionStore.getState().createSubCollection('A');
    const b = useCollectionStore.getState().createSubCollection('B');
    useCollectionStore.getState().reorderSubCollections([b, a]);
    const defs = useCollectionStore.getState().subCollections;
    expect(defs.map((d) => d.id)).toEqual([b, a]);
    expect(defs.map((d) => d.order)).toEqual([0, 1]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --prefix frontend -- src/store/collection-subcollections.test.ts`
Expected: FAIL — `createSubCollection is not a function`.

- [ ] **Step 3: Add state field + action signatures to `CollectionState`**

In `frontend/src/store/collection.ts`, in the `interface CollectionState` block, add the state field next to `binders: BinderDef[];`:

```ts
  subCollections: SubCollectionDef[];
```

Add these action signatures in the "Binder card customization actions" region (or directly above `// Binder actions`):

```ts
  // Sub-collection actions
  createSubCollection: (name: string, color?: string) => string;
  renameSubCollection: (id: string, name: string) => void;
  recolorSubCollection: (id: string, color: string) => void;
  reorderSubCollections: (orderedIds: string[]) => void;
  deleteSubCollection: (id: string) => Promise<void>;
  moveCardsToSubCollection: (
    copyIds: string[],
    subCollectionId: string | null
  ) => Promise<void>;
```

Add the imports at the top of the file:

```ts
import type { SubCollectionDef } from '../types';
import { assignSubCollection, clampSubCollectionName } from '../lib/sub-collections';
```

(Merge `SubCollectionDef` into the existing `../types` type-import if one exists.)

- [ ] **Step 4: Add a private persistence helper + initial state**

Find the `mergeCards` helper (lines 161–163). Directly **below** it add a shared snapshot builder so the new mutators don't duplicate the `StoredCollection` literal:

```ts
function buildStored(s: {
  cards: EnrichedCard[];
  fileName: string;
  scryfallHits: number;
  scryfallMisses: number;
  uploadedAt: number | null;
  importHistory: ImportHistoryEntry[];
  subCollections: SubCollectionDef[];
}): StoredCollection {
  return {
    cards: s.cards,
    fileName: s.fileName,
    scryfallHits: s.scryfallHits,
    scryfallMisses: s.scryfallMisses,
    uploadedAt: s.uploadedAt ?? Date.now(),
    importHistory: s.importHistory,
    subCollections: s.subCollections,
  };
}
```

In the store's initial state object (where `binders: []` etc. are initialized — same object that sets `cards: []`), add:

```ts
      subCollections: [],
```

- [ ] **Step 5: Implement the mutators**

Add these implementations in the store body, next to the binder customization actions:

```ts
      createSubCollection: (name, color) => {
        const id =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `sc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const defs = get().subCollections;
        const def: SubCollectionDef = {
          id,
          name: clampSubCollectionName(name) || 'Untitled',
          order: defs.length,
          ...(color ? { color } : {}),
        };
        set({ subCollections: [...defs, def] });
        void get().moveCardsToSubCollection([], id); // persist defs (no card change)
        return id;
      },

      renameSubCollection: (id, name) => {
        set({
          subCollections: get().subCollections.map((d) =>
            d.id === id ? { ...d, name: clampSubCollectionName(name) || d.name } : d
          ),
        });
        void get().moveCardsToSubCollection([], null);
      },

      recolorSubCollection: (id, color) => {
        set({
          subCollections: get().subCollections.map((d) =>
            d.id === id ? { ...d, color } : d
          ),
        });
        void get().moveCardsToSubCollection([], null);
      },

      reorderSubCollections: (orderedIds) => {
        const byId = new Map(get().subCollections.map((d) => [d.id, d]));
        const reordered = orderedIds
          .map((id, i) => {
            const d = byId.get(id);
            return d ? { ...d, order: i } : null;
          })
          .filter((d): d is SubCollectionDef => d !== null);
        set({ subCollections: reordered });
        void get().moveCardsToSubCollection([], null);
      },

      deleteSubCollection: async (id) => {
        const cards = get().cards.map((c) =>
          c.subCollectionId === id ? assignSubCollection(c, null) : c
        );
        const subCollections = get().subCollections
          .filter((d) => d.id !== id)
          .map((d, i) => ({ ...d, order: i }));
        set({ cards, subCollections });
        remapDeckAllocations(cards);
        try {
          await saveCollection(buildStored({ ...get(), cards, subCollections }));
        } catch (err) {
          console.warn('[store] Failed to persist after deleteSubCollection:', err);
        }
      },

      moveCardsToSubCollection: async (copyIds, subCollectionId) => {
        const ids = new Set(copyIds);
        const cards =
          ids.size === 0
            ? get().cards
            : get().cards.map((c) =>
                ids.has(c.copyId) ? assignSubCollection(c, subCollectionId) : c
              );
        if (ids.size > 0) set({ cards });
        try {
          await saveCollection(buildStored({ ...get(), cards }));
        } catch (err) {
          console.warn('[store] Failed to persist after moveCardsToSubCollection:', err);
          set({
            error:
              'Sub-collection change saved in memory but could not be saved locally. It will be lost if you refresh the page.',
          });
        }
      },
```

> Note: CRUD mutators call `moveCardsToSubCollection([], ...)` purely to persist the updated `subCollections` through the shared path — DRY over duplicating the `saveCollection` call.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test --prefix frontend -- src/store/collection-subcollections.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + lint**

Run: `npm run typecheck --prefix frontend && npm run lint --prefix frontend`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/store/collection.ts frontend/src/store/collection-subcollections.test.ts
git commit -m "feat(subcollections): store state + CRUD/move mutators"
```

---

## Task 4: Thread persistence + extend import (durability)

**Files:**

- Modify: `frontend/src/store/collection.ts` — `hydrateCards` (211–248), `importCards` (250–331), `buildBackupSnapshot` (529–542), `restoreFromBackup` (545–577)
- Modify: `frontend/src/store/collection-subcollections.test.ts` (add import-durability tests)

- [ ] **Step 1: Add the failing durability tests**

Append to `frontend/src/store/collection-subcollections.test.ts`:

```ts
import type { UploadResponse } from '../types';

function uploadResponse(cards: EnrichedCard[]): UploadResponse {
  return {
    cards,
    totalRows: cards.length,
    scryfallHits: cards.length,
    scryfallMisses: 0,
    unresolvedNames: [],
    detectedFormat: 'plain',
  };
}

describe('sub-collection import durability', () => {
  it('stamps imported cards with the chosen subCollectionId', async () => {
    const id = useCollectionStore.getState().createSubCollection('Bulk');
    await useCollectionStore
      .getState()
      .importCards(uploadResponse([enriched('n1', 'sf1')]), 'f.csv', 'replace', {
        subCollectionId: id,
      });
    expect(useCollectionStore.getState().cards[0].subCollectionId).toBe(id);
  });

  it('restores assignments across a replace re-import by printing+finish', async () => {
    useCollectionStore.setState({ cards: [enriched('old', 'sf1')] });
    const id = useCollectionStore.getState().createSubCollection('Bulk');
    await useCollectionStore.getState().moveCardsToSubCollection(['old'], id);

    await useCollectionStore
      .getState()
      .importCards(uploadResponse([enriched('fresh', 'sf1')]), 'f.csv', 'replace');

    const c = useCollectionStore.getState().cards[0];
    expect(c.copyId).toBe('fresh');
    expect(c.subCollectionId).toBe(id);
  });

  it('round-trips subCollections through hydrateCards', async () => {
    const id = useCollectionStore.getState().createSubCollection('Bulk');
    useCollectionStore.setState({ cards: [], subCollections: [] });
    await useCollectionStore.getState().hydrateCards();
    expect(useCollectionStore.getState().subCollections.find((d) => d.id === id)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --prefix frontend -- src/store/collection-subcollections.test.ts -t "import durability"`
Expected: FAIL — restore not applied / hydrate drops subCollections.

- [ ] **Step 3: Extend the `importCards` options type**

In `CollectionState`, the current signature is:

```ts
importCards: (
  response: UploadResponse,
  fileName: string,
  mode: ImportMode,
  options?: { isSample?: boolean; binderName?: string; binderColor?: string }
) => Promise<void>;
```

Change the options object to add `subCollectionId`:

```ts
    options?: {
      isSample?: boolean;
      binderName?: string;
      binderColor?: string;
      subCollectionId?: string;
    }
```

- [ ] **Step 4: Apply stamping + restore inside `importCards`**

In the `importCards` body, the current lines compute:

```ts
const stamped = response.cards.map((c) => ({ ...c, importId }));
const collectionMode = mode === 'binder' ? 'merge' : mode;
const newCards = collectionMode === 'merge' ? mergeCards(existing, stamped) : stamped;
```

Replace those three lines with:

```ts
const baseStamped = response.cards.map((c) => ({ ...c, importId }));
const stamped = options?.subCollectionId
  ? baseStamped.map((c) => assignSubCollection(c, options.subCollectionId!))
  : restoreSubCollectionAssignments(baseStamped, existing);
const collectionMode = mode === 'binder' ? 'merge' : mode;
const newCards = collectionMode === 'merge' ? mergeCards(existing, stamped) : stamped;
```

Add to the imports from `../lib/sub-collections`:

```ts
import {
  assignSubCollection,
  clampSubCollectionName,
  restoreSubCollectionAssignments,
} from '../lib/sub-collections';
```

In the same `importCards`, the persistence call currently is:

```ts
await saveCollection({
  cards: newCards,
  fileName,
  scryfallHits: response.scryfallHits,
  scryfallMisses: response.scryfallMisses,
  uploadedAt,
  importHistory,
});
```

Replace it with the shared builder so `subCollections` persists too:

```ts
await saveCollection(
  buildStored({
    cards: newCards,
    fileName,
    scryfallHits: response.scryfallHits,
    scryfallMisses: response.scryfallMisses,
    uploadedAt,
    importHistory,
    subCollections: get().subCollections,
  })
);
```

- [ ] **Step 5: Load `subCollections` in `hydrateCards`**

In `hydrateCards`, the current `set({...})` (lines 229–236) sets `cards/fileName/.../importHistory`. Add to that object:

```ts
              subCollections: stored.subCollections ?? [],
```

- [ ] **Step 6: Thread through backup snapshot/restore**

`buildBackupSnapshot` (529–542) builds an inline collection literal. Add `subCollections: s.subCollections,` to that literal (alongside `importHistory: s.importHistory,`).

`restoreFromBackup` (551–563) `set({...})` block: add

```ts
          subCollections: collection?.subCollections ?? [],
```

and in its `saveCollection({...})` call (570–577) add:

```ts
              subCollections: collection?.subCollections ?? [],
```

> `Backup.collection` is a `StoredCollection`, which now carries `subCollections` (Task 1) — no `backup.ts` change needed; just stop dropping the field on the way out/in.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test --prefix frontend -- src/store/collection-subcollections.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 8: Typecheck + lint**

Run: `npm run typecheck --prefix frontend && npm run lint --prefix frontend`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/store/collection.ts frontend/src/store/collection-subcollections.test.ts
git commit -m "feat(subcollections): persist + restore across import/hydrate/backup"
```

---

## Task 5: Sync round-trip

**Files:**

- Modify: `frontend/src/lib/sync.ts` — `buildCollection` (132–143), `hydrateFromCache` setState (294–302), `applyServerSnapshot` setState (369–378)
- Modify: `frontend/src/lib/sync.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `frontend/src/lib/sync.test.ts` (the imports/`beforeEach` already exist at the top, lines 1–35 — just add `subCollections: []` to the `useCollectionStore.setState({...})` reset in `beforeEach`):

```ts
describe('subCollections sync', () => {
  it('includes subCollections in the pushed collection blob', async () => {
    const putSpy = vi.spyOn(authApi, 'putSync').mockResolvedValue({ version: 1, updatedAt: 0 });
    useCollectionStore.setState({
      cards: [],
      fileName: 'x.csv',
      uploadedAt: 1,
      subCollections: [{ id: 'sc1', name: 'Bulk', order: 0 }],
    });
    await flushSync();
    expect(putSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: expect.objectContaining({
          subCollections: [{ id: 'sc1', name: 'Bulk', order: 0 }],
        }),
      })
    );
  });

  it('applies server subCollections on snapshot', async () => {
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: {
        fileName: 'remote.csv',
        cards: [],
        scryfallHits: 0,
        scryfallMisses: 0,
        uploadedAt: 1,
        importHistory: [],
        subCollections: [{ id: 'rsc', name: 'Server', order: 0 }],
      },
      binders: [],
      decks: [],
      games: [],
      version: 3,
      updatedAt: 1,
    });
    await startSync('user-1');
    await flushSync();
    expect(useCollectionStore.getState().subCollections).toEqual([
      { id: 'rsc', name: 'Server', order: 0 },
    ]);
  });
});
```

> Match the exact `fetchSync` mock shape already used elsewhere in `sync.test.ts`; if that file's existing snapshot mocks omit `games`, omit it here too.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --prefix frontend -- src/lib/sync.test.ts -t "subCollections sync"`
Expected: FAIL — pushed blob lacks `subCollections`; store not updated on snapshot.

- [ ] **Step 3: Push — extend `buildCollection`**

Current (sync.ts 132–143):

```ts
function buildCollection(): StoredCollection | null {
  const s = useCollectionStore.getState();
  if (!s.cards.length && !s.fileName && !s.uploadedAt) return null;
  return {
    fileName: s.fileName,
    cards: s.cards,
    scryfallHits: s.scryfallHits,
    scryfallMisses: s.scryfallMisses,
    uploadedAt: s.uploadedAt ?? Date.now(),
    importHistory: s.importHistory,
  };
}
```

Add `subCollections: s.subCollections,` to the returned object (after `importHistory`).

- [ ] **Step 4: Pull — extend both setState sites**

In `hydrateFromCache`, the `useCollectionStore.setState({...})` at 294–302 — add:

```ts
        subCollections: stored.subCollections ?? [],
```

In `applyServerSnapshot`, the `useCollectionStore.setState({...})` at 369–378 — add:

```ts
      subCollections: remoteCollection?.subCollections ?? [],
```

> The `keepLocalCollection` branch (352–366) deliberately keeps the local collection and only swaps non-collection slices — leave it untouched; local `subCollections` stay, consistent with local cards staying.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --prefix frontend -- src/lib/sync.test.ts -t "subCollections sync"`
Expected: PASS.

- [ ] **Step 6: Run the full sync suite (invariant guard)**

Run: `npm test --prefix frontend -- src/lib/sync.test.ts`
Expected: PASS — existing dirty-flag / mutation-during-fetch / hydrate-failed tests still green (additive optional field must not perturb them).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/sync.ts frontend/src/lib/sync.test.ts
git commit -m "feat(subcollections): sync push/pull through the collection blob"
```

---

## Task 6: Binder orthogonality regression test

**Files:**

- Modify: `frontend/src/lib/materialize.test.ts`

- [ ] **Step 1: Add the test**

Open `frontend/src/lib/materialize.test.ts`. Using that file's existing `makeCard`/`makeBinder` helpers and `materializeBinders` import (already present in the file — reuse them, do not redefine), add:

```ts
it('sub-collection assignment does not change binder membership (orthogonal)', () => {
  const inBucket = makeCard({ rarity: 'rare', subCollectionId: 'sc1' });
  const notInBucket = makeCard({ rarity: 'rare' });
  const rareBinder = makeBinder({
    filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
  });
  const { binders } = materializeBinders([inBucket, notInBucket], [rareBinder], defaultOpts);
  expect(binders[0].totalCards).toBe(2); // routed purely by the rarity filter
});
```

> If `defaultOpts` is named differently in this file, use whatever options object the file's other `materializeBinders(...)` calls pass. If `makeCard` doesn't spread arbitrary fields, set `subCollectionId` on the returned object before passing it in.

- [ ] **Step 2: Run to verify it passes**

Run: `npm test --prefix frontend -- src/lib/materialize.test.ts`
Expected: PASS — proves `subCollectionId` is inert to binder routing (orthogonality).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/materialize.test.ts
git commit -m "test(subcollections): assert binder membership is orthogonal to sub-collections"
```

---

## Task 7: Import-target selector (UI)

UI task — validated by user manually. Do **not** run preview/screenshot tools.

**Files:**

- Modify: `frontend/src/components/UploadPanel.tsx` — `ImportModeDialogProps` (607–612), options JSX (641–708), import call sites (130, 146–149)

- [ ] **Step 1: Extend the dialog contract**

Current props (607–612):

```ts
interface ImportModeDialogProps {
  existingCount: number;
  incomingPreview?: string;
  onPick: (mode: ImportMode, binderName?: string) => void;
  onCancel: () => void;
}
```

Change to:

```ts
interface ImportModeDialogProps {
  existingCount: number;
  incomingPreview?: string;
  subCollections: SubCollectionDef[];
  onPick: (mode: ImportMode, binderName?: string, subCollectionId?: string) => void;
  onCancel: () => void;
}
```

Import `SubCollectionDef` from `../types` and `useCollectionStore` actions as already used in this file. Add local state near the existing `binderName` state:

```ts
const [targetSubId, setTargetSubId] = useState<string>('');
```

- [ ] **Step 2: Render the selector inside the "Add to collection" option**

Directly **after** the "Add to collection" `<button>` (the first child of `<div className="choice-dialog-options">`, before the "Import as binder" block), add:

```tsx
<div className="choice-dialog-option choice-dialog-subcollection">
  <label className="choice-dialog-option-title" htmlFor="import-subcollection">
    Add to sub-collection
  </label>
  <select
    id="import-subcollection"
    className="binder-name-input"
    value={targetSubId}
    onChange={(e) => setTargetSubId(e.target.value)}
  >
    <option value="">Main</option>
    {subCollections.map((s) => (
      <option key={s.id} value={s.id}>
        {s.name}
      </option>
    ))}
  </select>
  <span className="choice-dialog-option-desc">New cards land here. Default is Main.</span>
</div>
```

Change the "Add to collection" button's `onClick` from:

```tsx
onClick={() => onPick(existingCount > 0 ? 'merge' : 'replace')}
```

to:

```tsx
onClick={() =>
  onPick(existingCount > 0 ? 'merge' : 'replace', undefined, targetSubId || undefined)
}
```

And the danger "Replace collection" button's `onClick` from `() => onPick('replace')` to `() => onPick('replace', undefined, targetSubId || undefined)`.

- [ ] **Step 3: Pass the prop and thread to the store call**

Where `<ImportModeDialog .../>` is rendered, pass `subCollections={useCollectionStore.getState().subCollections}` (or the existing store-selector hook this file uses for binders — match the file's pattern).

Update both `importCards(...)` call sites. Current (146–149):

```ts
await importCards(result, p.label, mode, {
  isSample: p.isSample,
  binderName,
});
```

and line 130 `await importCards(result, file.name, fileMode, { isSample: p.isSample, binderName });`

Thread the chosen `subCollectionId` (captured from the updated `onPick` signature into the same local variable the component already uses for `binderName`/`mode`) into the options object:

```ts
await importCards(result, p.label, mode, {
  isSample: p.isSample,
  binderName,
  subCollectionId,
});
```

(Add `subCollectionId` to the `onPick` handler params where `binderName`/`mode` are currently captured.)

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck --prefix frontend && npm run lint --prefix frontend`
Expected: PASS.

- [ ] **Step 5: Manual verification (user)**

Ask the user to confirm: importing with a sub-collection selected stamps the new cards (visible once Task 9/10 land); default stays Main. Do not run preview tooling.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/UploadPanel.tsx
git commit -m "feat(subcollections): import-target selector in the import dialog"
```

---

## Task 8: Single-card dropdown in CardEditDialog (UI)

**Files:**

- Modify: `frontend/src/components/CardEditDialog.tsx` — Props (14–22), JSX after the finish selector (~222), `handleConfirm` (151–158)

- [ ] **Step 1: Extend the contract**

Current Props (14–22):

```ts
interface Props {
  cardName: string;
  currentScryfallId: string;
  currentFinish: Finish;
  quantity?: number;
  onConfirm: (selection: PrintingSelection) => void;
  onCancel: () => void;
}
```

Add two fields:

```ts
  subCollections?: SubCollectionDef[];
  currentSubCollectionId?: string;
```

Add to the `PrintingSelection` type (defined in this file or its types module) an optional `subCollectionId?: string | null`. Import `SubCollectionDef` from `../types`.

Add local state near `selectedFinish`:

```ts
const [selectedSubId, setSelectedSubId] = useState<string>(currentSubCollectionId ?? '');
```

- [ ] **Step 2: Render the dropdown**

Directly **after** the finish-selector block (the `{availableFinishes.length > 1 && (...) }` ending ~line 222), add:

```tsx
{
  subCollections && subCollections.length > 0 && (
    <div className="card-edit-subcollection" role="group" aria-label="Sub-collection">
      <label className="card-edit-subcollection-label" htmlFor="card-edit-sub">
        Sub-collection
      </label>
      <select
        id="card-edit-sub"
        value={selectedSubId}
        onChange={(e) => setSelectedSubId(e.target.value)}
      >
        <option value="">Main</option>
        {subCollections.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 3: Emit the selection on confirm**

Current `handleConfirm` (151–158):

```ts
const handleConfirm = () => {
  if (!selectedCard) return;
  onConfirm({
    card: selectedCard,
    finish: selectedFinish,
    ...(quantity !== undefined ? { quantity: qty } : {}),
  });
};
```

Add the sub-collection to the payload:

```ts
const handleConfirm = () => {
  if (!selectedCard) return;
  onConfirm({
    card: selectedCard,
    finish: selectedFinish,
    subCollectionId: selectedSubId || null,
    ...(quantity !== undefined ? { quantity: qty } : {}),
  });
};
```

- [ ] **Step 4: Apply it at the call site**

Find where this dialog's `onConfirm` is handled (the collection edit-card flow that calls `updateCard`/`replaceAllCards`). After the existing update, if `selection.subCollectionId !== undefined`, call:

```ts
await useCollectionStore
  .getState()
  .moveCardsToSubCollection([editedCopyId], selection.subCollectionId);
```

Pass `subCollections={useCollectionStore.getState().subCollections}` and `currentSubCollectionId={card.subCollectionId}` when rendering `<CardEditDialog/>` in the collection flow. (Leave non-collection usages — they pass no `subCollections`, so the block is hidden.)

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck --prefix frontend && npm run lint --prefix frontend`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/CardEditDialog.tsx
git commit -m "feat(subcollections): single-card sub-collection dropdown"
```

---

## Task 9: Bulk-select + "Move to…" toolbar (UI)

**Files:**

- Modify: `frontend/src/components/CardListTable.tsx` (Props 47–58, Row 60–73, the row render/virtualizer body)
- Modify: `frontend/src/components/CardRowMenu.tsx` (add a per-row item)

- [ ] **Step 1: Add selection state + a checkbox column**

In `CardListTable`, add selection state at the top of the component body:

```ts
const [selectedCopyIds, setSelectedCopyIds] = useState<Set<string>>(new Set());
const subCollections = useCollectionStore((s) => s.subCollections);
const moveCardsToSubCollection = useCollectionStore((s) => s.moveCardsToSubCollection);
const createSubCollection = useCollectionStore((s) => s.createSubCollection);
const toggleRow = (copyId: string) =>
  setSelectedCopyIds((prev) => {
    const next = new Set(prev);
    next.has(copyId) ? next.delete(copyId) : next.add(copyId);
    return next;
  });
```

In the row markup (the virtualized row template that already renders each `Row`), add as the first cell:

```tsx
<input
  type="checkbox"
  aria-label={`Select ${row.card.name}`}
  checked={selectedCopyIds.has(row.card.copyId)}
  onChange={() => toggleRow(row.card.copyId)}
/>
```

(Mirror the existing column/cell class names used by sibling cells so layout stays consistent.)

- [ ] **Step 2: Add the bulk toolbar**

Render directly above the table/list container, only when a selection exists:

```tsx
{
  selectedCopyIds.size > 0 && (
    <div className="card-list-bulk-toolbar" role="region" aria-label="Bulk actions">
      <span>{selectedCopyIds.size} selected</span>
      <select
        aria-label="Move selected to sub-collection"
        defaultValue=""
        onChange={async (e) => {
          const v = e.target.value;
          if (!v) return;
          const targetId =
            v === '__new'
              ? createSubCollection(window.prompt('New sub-collection name')?.trim() || 'Untitled')
              : v === '__main'
                ? null
                : v;
          await moveCardsToSubCollection([...selectedCopyIds], targetId);
          setSelectedCopyIds(new Set());
        }}
      >
        <option value="">Move to…</option>
        <option value="__main">Main</option>
        {subCollections.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
        <option value="__new">+ New sub-collection…</option>
      </select>
      <button type="button" onClick={() => setSelectedCopyIds(new Set())}>
        Clear
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Add the per-row menu item**

In `CardRowMenu.tsx`, alongside the existing "Edit card" / "Move to binder" / "Remove" `role="menuitem"` buttons, add:

```tsx
<button type="button" role="menuitem" onClick={() => onMoveToSubCollection?.()}>
  Move to sub-collection…
</button>
```

Add `onMoveToSubCollection?: () => void;` to `CardRowMenu`'s props and wire it from `CardListTable` to open the same `<select>`/prompt path scoped to that single `row.card.copyId` (reuse the Step 2 handler with a one-element array). Match the existing prop-passing pattern used for `onEditCard`/`onDelete`.

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck --prefix frontend && npm run lint --prefix frontend`
Expected: PASS.

- [ ] **Step 5: Manual verification (user)**

User confirms: select rows → "Move to…" reassigns and clears selection; "+ New" creates and assigns; per-row menu item works. No preview tooling.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/CardListTable.tsx frontend/src/components/CardRowMenu.tsx
git commit -m "feat(subcollections): bulk-select + move-to toolbar and row action"
```

---

## Task 10: Sub-collection view filter + counts (UI)

**Files:**

- Modify: `frontend/src/pages/CollectionPage.tsx`

- [ ] **Step 1: Add a filter selector + counts**

In `CollectionPage`, read state:

```ts
const subCollections = useCollectionStore((s) => s.subCollections);
const cards = useCollectionStore((s) => s.cards);
const [subFilter, setSubFilter] = useState<string>(''); // '' = all, '__main' = Main, else id
```

Compute counts (Main = no id, or an id that no longer resolves):

```ts
const validIds = new Set(subCollections.map((d) => d.id));
const countFor = (id: string | null) =>
  cards.filter((c) =>
    id === null ? !c.subCollectionId || !validIds.has(c.subCollectionId) : c.subCollectionId === id
  ).length;
```

Render near the existing hero/stats row:

```tsx
<div className="collection-subfilter" role="group" aria-label="Sub-collection filter">
  <button
    type="button"
    className={subFilter === '' ? 'is-active' : ''}
    onClick={() => setSubFilter('')}
  >
    All ({cards.length})
  </button>
  <button
    type="button"
    className={subFilter === '__main' ? 'is-active' : ''}
    onClick={() => setSubFilter('__main')}
  >
    Main ({countFor(null)})
  </button>
  {subCollections.map((s) => (
    <button
      key={s.id}
      type="button"
      className={subFilter === s.id ? 'is-active' : ''}
      onClick={() => setSubFilter(s.id)}
    >
      {s.name} ({countFor(s.id)})
    </button>
  ))}
</div>
```

- [ ] **Step 2: Scope the rendered list (view only)**

Where `CollectionPage` currently builds the `cards` array it passes to `<CardListTable cards={...}>`, wrap it:

```ts
const visibleCards =
  subFilter === ''
    ? cards
    : subFilter === '__main'
      ? cards.filter((c) => !c.subCollectionId || !validIds.has(c.subCollectionId))
      : cards.filter((c) => c.subCollectionId === subFilter);
```

Pass `visibleCards` to `CardListTable` instead of `cards`. **Do not** alter what is passed to binder materialization — binders must continue to see all cards (orthogonality; Task 6 guards this).

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck --prefix frontend && npm run lint --prefix frontend`
Expected: PASS.

- [ ] **Step 4: Manual verification (user)**

User confirms: filter chips switch the visible list and show correct counts; binders/decks unaffected; an unknown id falls under Main. No preview tooling.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/CollectionPage.tsx
git commit -m "feat(subcollections): collection view filter + per-bucket counts"
```

---

## Task 11: Full verification

- [ ] **Step 1: Run the full gate**

Run: `npm run typecheck && npm run lint && npm run format:check && npm test`
Expected: PASS, including the frontend `src/lib/**` 80% coverage threshold (new logic in `sub-collections.ts`, `sync.ts` covered by Tasks 2 & 5).

- [ ] **Step 2: If `format:check` fails**

Run: `npm run format` then re-run Step 1; commit the formatting:

```bash
git add -A && git commit -m "chore: prettier"
```

- [ ] **Step 3: Confirm branch is clean**

Run: `git status` — expected clean working tree on `feat/sub-collections`.

- [ ] **Step 4: Hand back to the user**

Report: all tasks complete, full gate green. Ask whether to open a PR (per project preference: no Claude attribution in the PR body/commits).

---

## Self-Review

- **Spec coverage:** Data model → T1; pure logic + Main-as-undefined → T2; CRUD/move + delete-to-Main → T3; durability via printingFinishKey reuse + import stamping + backup → T4; sync push/pull + invariants → T5; binder orthogonality → T6; import selector → T7; single-card → T8; bulk UI (the one net-new surface) → T9; view filter + counts + unknown-id→Main → T10; security clamp (`clampSubCollectionName`) → T2/T3; full gate → T11. No uncovered spec section.
- **Placeholder scan:** No TBD/TODO; every code step has concrete code; UI tasks include full JSX. The few "match the file's existing pattern" notes are deliberate guards (exact sibling-class names depend on local CSS) and always pair with concrete code, not a substitute for it.
- **Type consistency:** `SubCollectionDef {id,name,color?,order}`, `subCollectionId?`, `subCollectionKey?`, `assignSubCollection`, `restoreSubCollectionAssignments`, `resolveSubCollectionId`, `clampSubCollectionName`, `buildStored`, `moveCardsToSubCollection`, `createSubCollection` are used with identical signatures across T2–T10. `importCards` options extended once (T4) and consumed with the same shape in T7.
